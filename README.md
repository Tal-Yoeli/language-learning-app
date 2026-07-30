# Language Learning App v0.7.0

A local-first language-learning app built with React Native, Expo, and
TypeScript. It runs on iPhone through Expo Go **and** as a responsive website on
desktop, laptop, tablet, and mobile browsers, from a single codebase.

## Version 0.7.0

### Responsive web app

- The same app now runs in a browser through react-native-web.
- Phones keep the existing layout exactly. Tablets get a centred column.
  Desktops get a persistent sidebar instead of the bottom tab bar, a bounded
  reading column, and a narrower measure for lesson questions.
- The whole shell caps and centres on ultra-wide monitors rather than stretching.
- Platform differences are isolated in `src/platform/*`, resolved by Metro's
  `.web.ts` extension, so mobile and web share all business logic and styling.

### Web equivalents for iPhone-only APIs

- Destructive confirmations use an in-app dialog on both platforms, because
  `Alert.alert` is a no-op in react-native-web.
- Voice playback caches audio in browser Cache Storage instead of the iOS file
  cache; replaying a phrase still costs no extra paid request.
- Recordings are read back from the browser's blob URL, and the real container
  (`webm` on Chrome and Firefox, `mp4` on Safari) is sent to OpenAI rather than a
  hardcoded `.m4a`.
- Backups download as a `.json` file on the web and can be re-imported by file.
  The iOS share sheet is unchanged.

### Spend protection for the AI features

- Each device gets an anonymous Supabase session, and every Edge Function
  enforces a 60-request daily quota against it.
- The public anon key alone no longer grants access to paid OpenAI calls.
- Edge Function CORS can be restricted to your own domain.

See `MIGRATION_NOTES.md` for the full feature-preservation matrix and known
limitations, and `DEPLOYMENT.md` for setup and deployment.

## Version 0.6.1

### Reliable daily progress

- Daily practice and daily XP now reset after local midnight.
- The date is checked while the app is open, whenever Expo Go returns to the
  foreground, and whenever you open Today.
- Lifetime XP, completed lessons, and other long-term progress remain saved.

## Version 0.6

### Focused tabs

- `Lesson` opens with the selected deck, lesson size, and one start action.
- Deck selection stays available through an expandable in-page control.
- `Add` shows only the required word and translation fields by default.
- Destination and example-sentence fields open only when needed.
- `AI` switches between `Create cards` and `Speaking`, so only one workflow is
  visible at a time.

### Flexible lesson answers

- Exact answers, configured alternatives such as `hello / hi`, and Unicode
  variants are checked instantly on the iPhone.
- Different wording is sent to the `evaluate-translation` Supabase Edge
  Function for semantic evaluation.
- Natural synonyms, harmless spelling mistakes, equivalent everyday phrasing,
  and Levantine Arabic dialect variants can be accepted even when they do not
  match the card text exactly.
- A learner can override a false negative and count their answer as correct.
- Changed meaning, negation, person, number, or important tense remains wrong.
- The OpenAI key remains in Supabase Secrets and is never added to Expo.

## Version 0.5

### Daily learning experience

- The app opens on a focused `Today` dashboard instead of library settings.
- A 10-activity daily goal, daily XP, streak, due-card count, and accuracy make
  progress visible without requiring an account.
- Card reviews, full lessons, and completed lesson recordings update the daily
  goal automatically.
- Daily activity is stored locally on the iPhone in AsyncStorage, separately
  from the language library.
- A one-tap lesson action and quick links to manual and AI card creation reduce
  navigation steps.
- Language, deck, AI deck-builder, card-editing, and backup controls remain
  available in collapsed management sections.
- Navigation and learning controls use consistent icons, pressed states, and
  iPhone haptic feedback while remaining fully compatible with Expo Go.

### Reliability and accessibility pass

- AI requests now stop waiting after a clear deadline and surface useful Edge
  Function error messages.
- OpenAI requests inside Edge Functions also have bounded upstream timeouts.
- Replaying the same word or sentence reuses the iPhone audio cache instead of
  creating another paid speech request.
- Photo and recording uploads have size guards, recordings stop after 30
  seconds, and native permission/setup failures return useful messages.
- Lesson answer checking handles Unicode diacritics and punctuation more fairly
  for Greek, Arabic, and Hebrew.
- Core tabs, buttons, selection controls, fields, notices, and study cards now
  expose VoiceOver roles and states.
- The full audit, API evaluation, testing checklist, and staged roadmap are in
  `AUDIT_AND_ROADMAP.md`.

### Lesson progress and mistake review

- Finishing a full lesson now saves one review result per tested card.
- A card with any wrong lesson answer returns to tomorrow's review; a fully
  correct card advances through the existing spaced-review schedule.
- Learners can choose `I don't know` to reveal an answer and continue instead
  of getting stuck on an empty field.
- Results compare the learner's response with the correct answer.
- Missed questions can be retried immediately in a focused short round without
  artificially increasing card progress a second time.

### AI Deck Builder

- In the Library tab, choose a language folder and describe a deck goal.
- Example goals: `clothing`, `hotel check-in`, `food market`, `family`.
- The app creates a new deck and asks OpenAI for at least 10 themed cards.
- Each generated card includes a term, translation, example sentence, and full
  sentence translation.
- The mobile app calls Supabase Edge Functions only; the OpenAI key remains on
  the server.

### Lessons

- Each lesson contains no more than 10 translation questions total.
- Questions are balanced across both translation directions.
- A deck with 10 or more cards uses 10 different cards in the exam.
- Smaller decks may reuse cards in the opposite direction.
- The exam is followed by up to 5 listening and recording exercises.
- Recording exercises are marked as completed after pronunciation feedback is
  received.

### Voice Playback

- Every study card can play its word or phrase aloud.
- Cards with an example sentence can play the full sentence.
- Every sentence in AI deck speaking practice has a `Hear` control.
- Lesson recording exercises include playback before recording.
- Playback uses OpenAI `gpt-4o-mini-tts` through a Supabase Edge Function.
- The default voice is `marin`, with natural native-language teaching
  instructions.
- OpenAI audio is returned as AAC and cached temporarily on the phone.
- The mobile app never receives the OpenAI API key.

The playback is AI-generated speech, not a human recording.

### Speaking Sentence Translations

- Cards store a separate translation for the complete example sentence.
- New AI-generated cards include this translation automatically.
- Manual card entry and card editing include a sentence-translation field.
- Lesson and AI speaking exercises show the translation under the sentence.
- Existing cards remain valid; sentence translations can be added by editing
  those cards.

## Run In A Browser

```powershell
npm run web
```

Then open the printed `http://localhost:8081`. To preview the production bundle
exactly as it will be served:

```powershell
npm run build:web
npm run serve:web
```

Microphone and camera features require HTTPS in production. `localhost` is
exempt during development.

## Run On iPhone

Connect the computer and iPhone to the same Wi-Fi network, open Expo Go, and
run:

```powershell
npm run start:lan
```

If PowerShell blocks `npm.ps1`, use:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run start:lan
```

Scan the QR code or enter the displayed `exp://` URL.

This development mode depends on the computer staying awake because Expo Go is
loading the app from the local Metro server.

This project intentionally uses Expo Go and does not require an Apple Developer
account or an installable iOS build. Keep this computer awake and the Expo
development server running while using the app on the iPhone.

## Environment

Create `.env` from `.env.example`:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Keep `OPENAI_API_KEY` only in Supabase Edge Function secrets.

Deploy all required functions:

```powershell
supabase functions deploy analyze-learning-material
supabase functions deploy pronunciation-feedback
supabase functions deploy synthesize-speech
supabase functions deploy generate-themed-deck
supabase functions deploy evaluate-translation
```

Redeploy all five functions after changing files under
`supabase/functions/_shared`, because each deployed function bundles its own
copy of shared code.

If Supabase CLI reports that the project status is `INACTIVE`, open the
Supabase dashboard and resume the project before deploying functions.

The AI features additionally require **Anonymous sign-ins** to be enabled in the
Supabase dashboard, and the quota migration in `supabase/migrations/` to be
applied. Both are one-time steps; `DEPLOYMENT.md` has the exact instructions.

## Verification

```powershell
npm run typecheck      # strict TypeScript, must be clean
npm run test:learning  # 24 unit tests over the pure logic
npm run build:web      # production web bundle -> dist/
npm run build:ios      # proves the mobile app still builds
```

The project remains on Expo SDK 54 for compatibility with the installed iOS
Expo Go version.
