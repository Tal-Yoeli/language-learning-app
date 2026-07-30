# Web migration notes

How the iPhone app became a responsive website, what changed, and what is still
worth knowing. Written 2026-07-28 against Expo SDK 54.

## Approach

One Expo codebase, with react-native-web added. The app was **not** rewritten in
Next.js: `src/AppV5.tsx` is ~4,100 lines of React Native primitives, and porting
that to DOM and CSS would have meant re-implementing every feature by hand —
exactly the kind of rewrite that loses behaviour. There is no SSR or SEO
requirement, and the OpenAI key already lives correctly in Supabase Edge
Functions, so Next.js would have bought nothing and cost a fork between mobile
and web.

Everything that differs between platforms sits in four small modules under
`src/platform/`, resolved by Metro's `.web.ts` extension. All business logic,
every screen, and all styling are shared.

```
                 index.ts -> App.tsx -> src/AppV5.tsx
                                  |
              src/ui/AppShell.tsx      src/platform/*.ts | *.web.ts
              responsive chrome          speechCache · recording
                                         backup      · imagePicker
                       |                           |
        iOS (Expo Go)                      Browser (static SPA)
        AsyncStorage                       localStorage
        FileSystem cache                   Cache Storage + blob URLs
                       \                  /
                    Supabase anonymous session (JWT)
                                  |
                Edge Functions: verify caller + daily quota
                                  |
                     OpenAI (key never leaves Supabase)
```

## Feature preservation

Nothing was removed. Every item below was verified in the production web build
unless the "Verified" column says otherwise.

| Feature | Web status | Verified |
| --- | --- | --- |
| Language folders, decks, card CRUD | Works unchanged | Build + layout screenshots |
| Local persistence, v2→v5 migrations | AsyncStorage maps to `localStorage` | Demo library loads on first run |
| Lessons, both directions, retry round | Pure logic, unchanged | Unit tests |
| Unicode-aware answer matching | Pure logic, unchanged | Unit tests |
| AI semantic answer evaluation | Edge Function, unchanged | Needs your Supabase steps |
| SRS scheduling, XP, streaks, daily goal | Unchanged | Unit tests |
| Midnight rollover on app foreground | `AppState` maps to page visibility | Code path shared |
| AI deck builder, text → cards | Unchanged | Needs your Supabase steps |
| Photo → cards from library | Works; base64 read from the `File` when the browser omits it | Code path, `readAssetBase64` |
| Photo → cards from camera | Hidden where no camera or insecure origin, with a message pointing at upload | `supportsCameraCapture` |
| TTS playback | **Rebuilt for web** — see below | Code path |
| TTS caching (replay costs nothing) | Preserved via Cache Storage + in-session map | Deterministic key unit-tested |
| Mic recording → pronunciation feedback | **Rebuilt for web** — see below | Code path, MIME mapping unit-tested |
| Delete card / delete deck / restore backup confirms | **Rebuilt** as an in-app modal on *both* platforms | Code path |
| Backup export | Downloads a `.json` file on web; still the share sheet on iOS | Code path |
| Backup import | Paste JSON *and* a new file picker on web | Code path |
| Haptics | Vibration on mobile browsers, silently absent on desktop | Expected |
| Accessibility roles and live notice region | Map to ARIA; sidebar is a `<nav>`, tab bars are `tablist` | Code path |

### The three things that genuinely broke, and what replaced them

**1. `Alert.alert` is an empty function in react-native-web.**
Three destructive confirmations — delete card, delete deck, restore backup —
would have silently done nothing in a browser, with no error. Replaced with
`src/ui/ConfirmDialog.tsx`, a `Modal`-based dialog used on *both* platforms, so
iOS and web behave identically rather than diverging.

**2. `expo-file-system` has no web implementation.**
`cacheDirectory` is `null` in a browser, which killed all voice playback, and
`readAsStringAsync` was how recorded audio reached the pronunciation function,
which killed all speaking practice. Replaced by `src/platform/speechCache.web.ts`
(Cache Storage plus blob URLs, keyed by the same deterministic hash so a replay
still costs zero paid TTS requests) and `src/platform/recording.web.ts`
(`fetch` the blob URL, convert to base64).

**3. Audio formats differ by platform.**
iOS records `.m4a` and plays AAC. Browsers record `audio/webm` (Chrome, Firefox)
or `audio/mp4` (Safari), and Firefox cannot reliably decode raw AAC. The old code
hardcoded `audio/mp4` / `pronunciation.m4a`, which would have mislabelled every
Chrome recording sent to OpenAI. Now the real container is detected and mapped to
an extension OpenAI accepts (`src/platform/audioMime.ts`), and the web build asks
`synthesize-speech` for MP3 while iOS keeps requesting AAC.

`Share.share` was the fourth wrinkle: it resolves only where `navigator.share`
exists, which excludes desktop Firefox and most desktop Chrome. The web build
downloads a real `.json` file instead, which is also more useful — it can be
re-imported by file.

## Responsive design

Breakpoints live in `src/ui/breakpoints.ts` as pure functions (unit tested), used
through `useResponsiveLayout()`. React Native `StyleSheet` has no media queries,
so breakpoints are evaluated in JS from `useWindowDimensions` — which has the
side benefit of working identically for native tablet rotation.

| Width | Layout |
| --- | --- |
| `< 768px` | Unchanged from the iPhone build: full-bleed column, bottom tab bar. The tab bar's colours, sizes, and padding were copied over verbatim. |
| `768–1023px` | Centred 720px column, bottom tab bar, 3-up deck grid |
| `≥ 1024px` | Persistent left sidebar replaces the tab bar; 860px content column; lesson questions narrow to 640px so they are not stretched |
| `≥ 1200px` | Management panels flow two-up instead of stacking |
| Ultra-wide | The whole shell caps at 1400px and centres, so the sidebar does not strand itself at the far edge of a 2560px monitor |

Verified by screenshot and by measuring `document.documentElement.scrollWidth`
against the viewport at 520, 834, 1024, 1440, and 2560px — no horizontal
overflow at any width.

Desktop affordances added: hover states on navigation, a narrower reading measure
for lesson questions, and a 3-up deck grid. The percentages in the deck grid
(48% / 31%) deliberately leave headroom for the 9px gap; an exact `100/n` split
overflows the row and wraps to one tile per line.

## Security

| Item | Before | Now |
| --- | --- | --- |
| OpenAI key | Supabase secrets only | Unchanged. Verified absent from the production bundle. |
| Who can call the paid functions | Anyone with the public anon key | Requires a real session; the anon key resolves to a null `auth.uid()` and is rejected by the database |
| Spend ceiling | None | 60 requests per device per UTC day, enforced by an atomic increment |
| CORS | `Access-Control-Allow-Origin: *` | Origin allowlist via `ALLOWED_ORIGINS` (permissive until you set it) |
| `verify_jwt` | Implicit default | Pinned in `supabase/config.toml` |

The important subtlety: gateway `verify_jwt` is **not** sufficient on its own,
because the project anon key is itself a valid JWT. The check that actually holds
is `auth.uid()` inside `consume_ai_quota()`, which PostgREST evaluates after
verifying the signature. The Edge Function cannot be tricked into skipping it,
and the daily limit is a constant inside the function rather than an argument, so
a client cannot request a larger allowance.

The database migration is additive only — one new table, one new function. It
does not read, alter, or drop anything that already exists, and no learner data
is stored server-side.

## Known limitations

1. **Web and phone libraries are separate.** Browser `localStorage` is a
   different store from the phone's AsyncStorage. Move a library across with
   *Download backup* → *Load backup file*. This was your explicit choice over
   building cross-device sync.
2. **`localStorage` holds roughly 5 MB** and is not encrypted. A very large
   library could hit the ceiling, and anyone with access to the same browser
   profile can read the cards. Card content is not sensitive, but a shared
   computer does expose it.
3. **Camera capture is hidden on most desktops.** `getUserMedia` needs a camera
   and a secure origin; where it is unavailable the button is not shown and
   "Choose photo" covers the same need.
4. **Haptics are silent on desktop.** No vibration hardware. Mobile browsers do
   vibrate.
5. **Pronunciation feedback is still transcript-based.** Unchanged from the
   mobile app, and still not phoneme-level assessment — see
   `AUDIT_AND_ROADMAP.md`.
6. **Prompt injection via pasted text or photos** is a pre-existing risk. Output
   is schema-constrained and only rendered as text, so the impact is limited to
   bad flashcards.
7. **The quota resets at UTC midnight**, not local midnight, unlike the daily
   practice goal which is local. This is deliberate — a server-side quota cannot
   trust a client's timezone.
8. **`supabase/schema.sql` remains unused.** `profiles`, `flashcards`, and
   `card_reviews` are still not read or written by the app. Left untouched.
9. **No automated browser tests.** Coverage is unit tests over pure logic plus
   production builds for both platforms. Component and end-to-end tests would be
   the next meaningful addition.

## Addendum (2026-07-30): admin-approved accounts

The local-first/anonymous model above was superseded shortly after this
document was written. The app now requires a signed-in, individually-approved
account on **both** platforms before anything is usable — including the local
flashcard library. This was an explicit, deliberate reversal of point 8 in
"Known limitations" above (`supabase/schema.sql` staying unused): `profiles`
is now actively read and written by a new `handle_new_user` trigger.

What stayed the same: flashcards/progress are still 100% local per device —
accounts are purely an access gate, not a data store, so none of the local-vs-
cloud tradeoffs above changed.

What's new:
- `supabase/migrations/20260730000000_user_approval.sql` — adds
  `profiles.approved` / `profiles.approval_token`, a trigger that creates a
  profile row the instant someone signs up, and extends `consume_ai_quota()`
  to reject unapproved callers server-side (not just hidden client-side).
- `supabase/functions/notify-signup` and `approve-user` — a `pg_net`-based
  database trigger (`supabase/migrations/20260730010000_notify_signup_trigger.sql`)
  calls `notify-signup` directly on every `profiles` insert, which emails
  `tal.yoeli@gmail.com` via Resend with a review link. No dashboard
  configuration is needed for this — a Supabase Database Webhook would do the
  same thing, but its UI location moves between Supabase versions, so calling
  the function straight from a trigger is more reliable. That link's `GET`
  only renders a confirmation page; the page's own button `POST`s the actual
  approval. This split matters because some corporate email scanners (e.g.
  Outlook Safe Links) silently pre-fetch every link in an email via `GET` — if
  `GET` itself approved the account, such a scanner would silently approve
  strangers.
- `src/auth/AuthGate.tsx` wraps `AppV5` from the outside — `AppV5.tsx` itself
  was not touched. It renders sign-in/sign-up, "waiting for approval", or the
  app, based on session + `profiles.approved`.
- Anonymous sign-in (added for the AI quota in the previous stage) is now
  disabled; real accounts serve that purpose instead.

Consequence: local development and your own iPhone testing now also require
signing up and being approved — there's no built-in bypass, since the entire
point is that nobody gets in without approval.

## Remaining improvements worth considering

- Playwright or similar for the major user journeys in a real browser.
- Break `src/AppV5.tsx` into per-screen modules; it is now ~4,150 lines.
- Runtime schema validation for restored backups (already flagged in
  `AUDIT_AND_ROADMAP.md`).
- Expo SDK 56 upgrade as an isolated task, with this web build as the regression
  baseline.
- A "last backup taken" indicator, now that browser storage is the only copy for
  web users.
