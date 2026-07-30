# Language Learning App: Audit and Roadmap

Audit date: 2026-07-16

## Scope and assumptions

The app is an Expo SDK 54 React Native/TypeScript iOS app, not a native
Swift/SwiftUI app. It is currently designed for one learner on one iPhone,
uses AsyncStorage as the source of truth, and uses Supabase Edge Functions as
the server-side boundary for OpenAI. Registration was intentionally removed.
The primary observed language use cases are Hebrew as the translation language
and Greek or Levantine Arabic as learning languages.

This audit is based on static repository review, TypeScript/Expo validation,
and iOS bundle export. Device-only behavior such as microphone quality,
VoiceOver navigation, camera permissions, and real network transitions still
requires the manual release checklist below.

## Implementation status

The first two low-risk passes are complete. The app now has bounded AI waits,
clearer server errors, media size and recording limits, deterministic speech
caching, core VoiceOver semantics, Unicode-aware answer matching, saved lesson
progress, an `I don't know` path, and focused mistake retries. The issue table
below records what the audit found before those fixes and remains useful as a
regression checklist.

## A. Executive summary

### Strengths

- The app is useful without an account and keeps the OpenAI key off the phone.
- Language folders, decks, manual cards, AI-created cards, two-way lesson
  questions, listening, recording, and local backup form a coherent MVP.
- Existing data migrations protect libraries created by earlier app versions.
- Structured output schemas make generated deck and feedback payloads more
  predictable than free-form parsing.
- The visual system is restrained, readable, and consistent across screens.

### Biggest risks

1. The public mobile configuration can invoke paid Edge Functions without a
   per-user quota or app-level abuse control. The anon key is intentionally
   public, so it cannot be treated as a spending-control secret.
2. The configured OpenAI speech model is now marked deprecated in the current
   model catalog. Voice playback needs a planned migration, not a silent model
   swap.
3. The learner's only automatic copy of their library is AsyncStorage on one
   device. App deletion, device loss, or storage corruption can remove all
   progress unless a manual JSON backup exists.
4. Pronunciation feedback is inferred from a transcript. It is useful for
   missing or incorrect words, but it is not phoneme-level pronunciation
   assessment and should not be presented as such.
5. There are no automated tests, and nearly all UI, storage, lesson, audio, and
   image logic lives in one component of roughly 3,000 lines.

### Highest-impact opportunities

- Add bounded network behavior, actionable errors, recording/image limits,
  deterministic speech caching, and VoiceOver semantics immediately.
- Add mistake-driven review and forgiving answer matching next; these improve
  learning more than decorative gamification.
- Add optional anonymous cloud backup/sync with explicit consent before the
  library becomes irreplaceable.
- Move on-device OCR to an iOS-native Vision module in a later native-build
  release, then send extracted text rather than the original image whenever
  possible.

## B. Bug and reliability report

| Severity | Location | Reproduction | Cause and impact | Recommended fix | Regression test |
| --- | --- | --- | --- | --- | --- |
| Critical | `supabase/functions/*/index.ts` | Obtain the public project URL and anon key from an installed bundle, then invoke an AI function repeatedly. | Edge Functions perform no per-install authorization, quota, or rate-limit check. A public anon key cannot prevent paid API abuse. | Use silent anonymous Supabase auth, verify the user JWT in every function, and enforce server-side per-user/day quotas. Add a global spending alert/cap. This changes backend architecture and needs approval. | Integration test: unauthenticated request is rejected; authenticated user exceeding quota gets 429; another user remains unaffected. |
| High | `supabase/functions/_shared/openai.ts:getSpeechModel` | Request voice playback after the configured model is retired. | The default `gpt-4o-mini-tts` is marked deprecated in the current OpenAI model catalog, creating a future hard failure. | Evaluate `tts-1-hd`, `gpt-audio`, or a Realtime model against Greek and Levantine Arabic samples before changing production. | Mock the speech endpoint and assert the configured model is supported; run a small pre-release voice smoke test for both target languages. |
| High | `src/lib/aiFunctions.ts` and `_shared/openai.ts` | Disable or severely throttle the network, then start deck generation, image analysis, speech, or pronunciation feedback. | Requests have no deadline. Loading controls can remain blocked indefinitely, and function errors lose useful response details. | Add client deadlines, parse Edge Function error bodies, and add server-side upstream timeouts. Do not automatically retry paid, non-idempotent generation calls. | Fake a never-resolving request and assert a clear timeout error and restored loading state. |
| High | `src/AppV5.tsx:startRecording/stopRecording` | Start recording, leave it running for several minutes, then submit. | High-quality audio is read entirely into memory, converted to base64, and uploaded with no duration or size limit. This can cause high memory use, latency, and paid API cost. | Limit recordings to 30 seconds, use a speech-appropriate mono/low-bitrate preset, reject oversized payloads, and show remaining time. | Recorder fixture over the limit is stopped/rejected; an allowed recording submits once. |
| High | `src/AppV5.tsx:loadLibrary/shareBackup` | Build a large library, delete the app or lose the phone without exporting a backup. | AsyncStorage is the only automatic data copy. Manual Share backup is easy to forget and large JSON messages may be awkward to restore. | Add optional anonymous encrypted cloud backup/sync; in the short term show last-backup state and export a file rather than message text. | Restore a fixture with hundreds of cards and verify counts, progress, examples, and selected deck. |
| High | `src/AppV5.tsx:checkLessonAnswer` | Enter a correct Arabic/Greek answer with diacritics, alternate apostrophe, or equivalent punctuation. | Exact normalized string equality creates false negatives and discouraging feedback. | Normalize Unicode, diacritics, apostrophes, and whitespace; later support accepted alternatives per card. | Table-driven tests for Greek accents, Arabic marks, Hebrew marks, punctuation, and genuinely wrong answers. |
| Medium | `src/AppV5.tsx:requestTextFeedback/stopRecording` | Pronounce the right words with poor sounds, or the wrong sounds that transcribe to the expected words. | Feedback receives only expected text and transcript after ASR. It cannot reliably measure phonemes or prosody. | Label it as speaking/transcript feedback. For real pronunciation scoring, evaluate a dedicated assessment service or an audio-capable model with a validated rubric. | Golden audio set scored by native speakers; compare model ranking and false-positive rate. |
| Medium | `src/AppV5.tsx:choosePhoto/takePhoto/analyzeImage` | Select a large modern iPhone photo on a slow connection. | The app requests base64 at 85% quality with no pixel resize or payload guard, then uploads the entire image. | Add an immediate payload guard now; later resize/compress and prefer on-device Vision OCR before cloud processing. | Fixture at limit is accepted; oversized fixture is blocked before invoking Supabase. |
| Medium | `src/AppV5.tsx:playSentence` | Tap the same sentence repeatedly across a study session. | Every tap calls paid TTS and writes a new timestamped cache file, despite the README describing caching. | Use a deterministic file key and reuse an existing cached file. The OS may purge the cache safely. | Mock TTS, play identical language/text twice, and assert one network call and one cache path. |
| Medium | `src/AppV5.tsx:choosePhoto/takePhoto/startRecording` | Deny permission, change it in Settings, or trigger a native picker/recorder error. | Some native calls are outside `try/catch`; denied states only show a transient notice and provide no Settings route. | Catch native failures and distinguish denied, restricted, and unavailable states. Add an Open Settings action later. | Mock denied and thrown permission results; assert no crash and useful message. |
| Medium | `src/AppV5.tsx` custom `Pressable` controls | Navigate with VoiceOver. | Most buttons, tabs, chips, cards, selected states, and live notices lack roles/states/labels. | Add accessibility roles, selected/disabled states, hints where useful, and live-region announcements. | React Native accessibility-props assertions plus manual VoiceOver order check. |
| Medium | `src/AppV5.tsx` | Increase iOS text size to an accessibility category. | Fixed two-column layouts and large fixed display text can clip or force awkward wrapping. The top/bottom safe areas are hardcoded. | Use real safe-area insets in a later UI pass, allow wrapping, and test Dynamic Type at AX5. | Screenshot/UI test at smallest iPhone and AX5 text size. |
| Medium | `src/AppV5.tsx:normalizeLibrary/restoreBackup` | Restore structurally valid JSON with missing arrays or wrong field types. | TypeScript casts untrusted JSON without runtime schema validation; normalization assumes nested arrays exist. | Add a versioned runtime validator and preserve the current library if validation fails. | Fuzz malformed backup fixtures and assert no crash or data replacement. |
| Medium | `src/AppV5.tsx` | Modify features or storage migrations. | A single large component couples persistence, business rules, networking, media, and rendering; there are no tests. | Extract pure library/lesson functions first, then media and AI hooks. Avoid a full rewrite. | Unit tests for extracted functions and one integration test per major flow. |
| Low | `src/AppV5.tsx:dueCards` | Leave the app open across a review due date without changing cards. | Due-card calculation only refreshes when `cards` changes. | Refresh the current time when the app returns active or at the next due boundary. | Fake time across midnight and assert the card becomes due. |
| Low | `src/lib/supabase.ts` and `supabase/schema.sql` | Inspect current no-account architecture. | Auth auto-refresh and legacy registration-oriented tables remain even though the app is local-first and has no sign-in UI. | Align schema and client auth with the future anonymous-backup decision; document unused legacy tables meanwhile. | Configuration test for the chosen auth mode. |

## C. API comparison

### Speech and pronunciation

| Option | Advantages | Disadvantages | Difficulty | Cost/privacy | Best use and recommendation |
| --- | --- | --- | --- | --- | --- |
| Current OpenAI transcription plus text feedback | Strong multilingual transcription; flexible feedback; existing server boundary; low migration effort. | Not phoneme-level assessment; round-trip latency; audio leaves device; current TTS default is deprecated. | Existing | Variable paid usage; Supabase and OpenAI process audio. | Keep transcription for MVP word/phrase correctness. Rename claims to speaking feedback, add limits, and separately migrate TTS after listening tests. |
| Apple Speech | Native iOS integration, partial/live results, no extra vendor, and on-device recognition where the locale/device supports it. | Locale support and accuracy vary; on-device mode can be less accurate; no dedicated pronunciation score. It requires a custom native iOS build and is outside the current Expo Go plan. | Medium to large | No per-call API fee; best privacy when on-device is supported. | Not planned while the app remains Expo Go-only. |
| Azure Speech Pronunciation Assessment | Purpose-built accuracy, fluency, completeness, and prosody-style scoring where supported. | Language/locale feature coverage must be checked carefully for Greek and Levantine Arabic; another cloud vendor and SDK; scoring can feel overly authoritative. | Large | Paid cloud processing; audio sent to Microsoft. | Consider only if validated target-locale support and native-speaker evals show a meaningful improvement. Do not migrate yet. |
| OpenAI Realtime/audio model | Lower-latency conversational practice and richer audio interaction than upload-then-wait. | More state, streaming, session security, cost controls, and QA complexity; still not automatically a validated pronunciation assessor. | Large | Potentially higher paid usage; cloud audio processing. | Long-term conversation simulation, not the next reliability release. |

### Image processing

| Option | Advantages | Disadvantages | Difficulty | Cost/privacy | Best use and recommendation |
| --- | --- | --- | --- | --- | --- |
| Current OpenAI vision input | One request can understand layout, infer useful vocabulary, translate, and return structured cards. | Uploads full images; no OCR confidence/bounding boxes; slower and more expensive than local OCR; weak preflight quality feedback. | Existing | Paid cloud processing; image leaves device. | Keep as fallback for complex pages and handwriting. Add compression/limits immediately. |
| Apple Vision OCR plus OpenAI text generation | On-device OCR, confidence scores, orientation/language controls, lower upload size, better privacy, and text can be reviewed before generation. | Requires native iOS integration and language-support testing, especially Arabic; OCR alone does not choose pedagogically useful words. | Medium to large | OCR is on-device/free; only reviewed text needs cloud processing. | Best medium-term iOS architecture. Prototype after the current reliability pass. |
| Apple Vision OCR only | Fully on-device extraction and direct `word - translation` pair import. | Cannot reliably select or translate vocabulary from arbitrary prose without additional language logic. | Medium | Lowest cost and strongest privacy. | Excellent for explicit pair lists and an offline import mode. |
| Cloud OCR provider | Mature document OCR, layout handling, and confidence metadata. | Adds vendor, cost, latency, data transfer, and little benefit for ordinary study-page photos compared with Vision plus OpenAI. | Large | Paid cloud image processing. | Not recommended until measured failure data proves Apple Vision is insufficient. |

No paid API or major provider migration should happen without sample-based
evaluation and explicit approval.

## D. Feature roadmap

### Quick wins

| Feature | Problem solved | Learning and engagement benefit | Difficulty/backend/privacy | Release |
| --- | --- | --- | --- | --- |
| Forgiving answer matching | Correct answers are marked wrong for marks/punctuation. | Fairer feedback and less frustration. | Small; no backend/privacy change. | MVP patch |
| Mistake review summary | Results show errors but do not create a focused retry loop. | Immediate retrieval practice on weak items. | Small; local only. | Next release |
| Clear progress per deck | Lifetime known/missed counts are hard to interpret. | Makes progress visible without arbitrary points. | Small; local model update. | Next release |
| Cached voice replay | Repeated listening costs time and money. | Faster imitation practice. | Small; local cache only. | MVP patch |
| Better permission/error states | Failures feel like dead ends. | Keeps learners in flow. | Small; no backend change. | MVP patch |

### Next release

| Feature | Problem solved | Learning and engagement benefit | Difficulty/backend/privacy | Release |
| --- | --- | --- | --- | --- |
| Adaptive mistake queue | All cards receive similar attention. | More time on weak words; better retention efficiency. | Medium; local scheduling fields. | Next release |
| Graduated hints | Binary answer checking is abrupt. | Supports recall before revealing the answer. | Medium; local only. | Next release |
| Weekly goal with forgiving recovery | No reason to return or sense of continuity. | Creates a sustainable habit without punishing missed days. | Medium; local date tracking. | Next release |
| Last-backup reminder | Valuable libraries can exist only on one phone. | Trust and continuity. | Small initially; no upload until user opts in. | Next release |
| Photo quality preview | Bad photos waste a paid request. | Faster successful card creation. | Medium; image metadata/local checks. | Next release |

### Medium-term improvements

| Feature | Problem solved | Learning and engagement benefit | Difficulty/backend/privacy | Release |
| --- | --- | --- | --- | --- |
| Optional anonymous cloud sync | Device loss removes progress. | Cross-device continuity and trust. | Large; auth, RLS, sync/conflicts, consent. | Medium term |
| Apple Vision OCR hybrid | Full images are uploaded unnecessarily. | Faster import and editable OCR before AI. | Large; native iOS module/build; better privacy. | Medium term |
| Conversation missions | Isolated cards do not build situational fluency. | Contextual production using deck vocabulary. | Large; AI prompts, quotas, safety review. | Medium term |
| Validated pronunciation rubric | Transcript feedback overstates sound accuracy. | More trustworthy speaking practice. | Large; audio eval set/provider study. | Medium term |

### Long-term experiments

- Realtime role-play using deck vocabulary. Solve passive practice; expected
  benefit is spontaneous recall. Large backend/cost/privacy surface. Run only
  behind a feature flag with session limits.
- Personalized AI exercise generation based on repeated mistakes. Solve stale
  review; expected benefit is transfer to new contexts. Medium-to-large, with
  careful prompt-injection and cost controls.
- Friend challenges are not recommended yet. The app currently serves a
  personal learning loop, and social identity/moderation would add substantial
  complexity without evidence of need.

## E. Testing plan

### Automated tests to add

1. Unit: library normalization/migrations, scheduling, answer normalization,
   lesson generation balance, sentence-translation lookup, backup validation.
2. Component: disabled/loading states, empty decks, selected chips/tabs,
   VoiceOver roles and states, correct/incorrect answer feedback.
3. Integration with mocks: all four Edge Functions, timeout, 400/401/429/500,
   malformed JSON, empty arrays, oversized images/audio, and slow responses.
4. Media service tests: denied/restricted permission, picker cancellation,
   recorder preparation failure, missing recording URI, cache hit/miss.
5. Edge Function tests with mocked `fetch`: OpenAI success, non-JSON error,
   timeout, rate limit, malformed structured output, empty transcription, and
   image/text validation. Never call a paid API in CI.
6. UI smoke tests in Expo Go on the real iPhone: launch, create deck/card, finish a
   lesson, play voice, record, photo import, backup, kill/relaunch, and restore.

### Manual release checklist

- Fresh install launches without Supabase configuration and demo cards work.
- Existing v2/v3/v4/v5 libraries migrate without losing counts or examples.
- Kill/relaunch preserves language, deck, cards, progress, and selection.
- Smallest supported iPhone and a large iPhone show no overlap or clipped text.
- Dynamic Type at default, largest standard, and AX5 remains usable.
- VoiceOver announces tabs, selected chips, flashcard action, buttons, loading,
  answer feedback, and score in a logical order.
- Light mode contrast is readable; dark mode is currently unsupported and must
  not be claimed.
- Camera, photo, and microphone: first allow, deny, deny permanently, cancel,
  and retry after changing iOS Settings.
- Airplane mode and slow network produce bounded, actionable errors.
- Greek and Levantine Arabic: card generation, both lesson directions, TTS,
  transcription, RTL rendering, punctuation, and diacritics.
- Blurry, dark, rotated, huge, handwritten, and no-text images fail safely.
- Recording in silence, noise, very short, and at the maximum duration.
- Supabase paused, quota exceeded, invalid key, and Edge Function 500 states.
- Backup and restore a large real library; verify card counts and progress.
- Expo Go reconnects after restarting Metro and AI features work on the iPhone.

## F. Implementation plan

| Task | Goal | Files likely to change | Risk | Test method | Complexity |
| --- | --- | --- | --- | --- | --- |
| 1 | Bound client AI waits and expose useful function errors. | `src/lib/aiFunctions.ts` | Low | Typecheck; mocked timeout/error tests later; manual paused-function check. | Small |
| 2 | Prevent repeated paid TTS calls and timestamp cache growth. | `src/AppV5.tsx` | Low | Play same phrase twice; inspect cache/network behavior. | Small |
| 3 | Catch native picker/recorder failures and reject oversized media. | `src/AppV5.tsx` | Low | Denied/thrown/oversized manual and mocked cases. | Small |
| 4 | Add VoiceOver roles, selected/disabled state, field labels, and live notice. | `src/AppV5.tsx` | Low | Manual VoiceOver plus component assertions later. | Small |
| 5 | Improve Unicode answer normalization. | New pure helper module and `AppV5.tsx` | Low | Table-driven unit tests once a test runner is added. | Small |
| 6 | Add test runner and extract pure library/lesson logic. | `package.json`, new `src/domain/*`, tests | Medium | Unit suite and iOS export. | Medium |
| 7 | Add 30-second automatic recording limit and lower speech-oriented encoding. | `AppV5.tsx`, audio configuration | Medium | Real iPhone timing/audio quality test. | Medium |
| 8 | Add runtime backup schema validation. | New validation module, `AppV5.tsx` | Medium | Malformed/fuzz fixture suite. | Medium |
| 9 | Add anonymous auth, per-user quotas, and optional sync. | Supabase schema/functions/client/data layer | High | RLS, quota, conflict, migration, and offline integration tests. | Large |
| 10 | Replace deprecated TTS model after listening evaluation. | `_shared/openai.ts`, function tests/config | Medium | Native-speaker samples in Greek and Levantine Arabic; latency/cost comparison. | Medium |
| 11 | Prototype Apple Vision OCR hybrid. | Native iOS module/config, image flow | High | OCR corpus for target languages and poor-quality images. | Large |

## Product metrics

Collect only aggregate events without card text, transcripts, recordings, or
images:

- Time to first manually created deck and first completed lesson.
- Lesson starts, completion rate, and drop-off question/stage.
- Answer success rate by direction and review status.
- Seven-day return rate and weekly active learners.
- Voice playback, recording, and image-import success/failure rates.
- Median and 95th-percentile Edge Function latency by function.
- Timeout, 429, permission-denied, and malformed-response rates.
- Backup recency and restore success, stored only as timestamps/status.

Analytics should be opt-in or clearly disclosed, use random installation/user
identifiers, and never include learning content or captured media.
