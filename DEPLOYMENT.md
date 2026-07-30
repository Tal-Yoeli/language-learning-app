# Deployment

The web app is a static single-page bundle produced by Expo. There is no server
to run: the only backend is the existing Supabase project.

```powershell
npm run build:web     # -> dist/
```

`dist/` contains `index.html`, a favicon, and one content-hashed JS bundle.

---

## 1. Manual steps you must do once

These cannot be done from the repository. Do them in this order.

### 1.1 Create a free Resend account (sends the "new signup" email to you)

1. Go to https://resend.com/signup and create a free account (100 emails/day,
   no credit card).
2. **API Keys** → **Create API Key** → give it any name → copy the key
   (starts `re_`).

You do **not** need to verify a domain — the function sends from
`onboarding@resend.dev`, which works immediately for a single recipient
(`tal.yoeli@gmail.com`) with zero setup.

### 1.2 Give me the Resend key as a Supabase secret

```powershell
npx supabase secrets set RESEND_API_KEY=re_your_key_here
```

Verify: `npx supabase secrets list` shows `RESEND_API_KEY` in the list (the
value itself is never shown back).

### 1.3 Apply the database migrations

1. Open **SQL Editor** in the Supabase dashboard.
2. Paste and run `supabase/migrations/20260728000000_ai_usage_quota.sql`
   (skip if already applied from the previous stage).
3. Paste and run `supabase/migrations/20260730000000_user_approval.sql`.
4. Paste and run `supabase/migrations/20260730010000_notify_signup_trigger.sql`
   — this is what sends you the "new signup" email; see step 1.5 below.
   (Or run `npx supabase db push --project-ref gxawhrkctjhneasimoek` once for
   all three, if you prefer the CLI.)

Expected result: `Success. No rows returned` for each.
Verify: **Table Editor** shows `profiles` with an `approved` column
(default `false`) and an `approval_token` column. All three migrations only
create or additively alter — nothing existing is dropped.

Rollback for `20260730000000_user_approval.sql`:

```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
alter table public.profiles drop column if exists approved;
alter table public.profiles drop column if exists approval_token;
```

Rollback for `20260730010000_notify_signup_trigger.sql`:

```sql
drop trigger if exists on_profile_created_notify on public.profiles;
drop function if exists public.notify_new_signup();
```

### 1.4 Redeploy every Edge Function (7 total: 5 existing + 2 new)

Required: each function bundles its own copy of `_shared/`, so the updated
approval check only takes effect after every function is redeployed.

If your CLI is not linked (`supabase link`), add `--project-ref gxawhrkctjhneasimoek`
to each command below. `approve-user` additionally needs `--no-verify-jwt` if
the CLI doesn't pick up its `verify_jwt = false` setting from
`supabase/config.toml` in your setup:

```powershell
npx supabase functions deploy analyze-learning-material --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy generate-themed-deck --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy evaluate-translation --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy pronunciation-feedback --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy synthesize-speech --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy notify-signup --project-ref gxawhrkctjhneasimoek
npx supabase functions deploy approve-user --project-ref gxawhrkctjhneasimoek --no-verify-jwt
```

Expected result: `Deployed Functions on project gxawhrkctjhneasimoek` for each.

If a function reports the project is `INACTIVE`, resume the project in the
dashboard first.

**Note on `.env` errors:** if `functions deploy` fails with `failed to parse
environment file: .env (unexpected character...)`, your `.env` file has a
UTF-8 byte-order mark at the start (common when a Windows editor saved it).
Re-save it as UTF-8 **without BOM**, or strip it with:
```powershell
$content = Get-Content .env -Raw
[System.IO.File]::WriteAllText("$pwd\.env", $content, (New-Object System.Text.UTF8Encoding($false)))
```

### 1.5 Confirm the "new signup" email trigger is active

No dashboard configuration needed for this — the migration in step 1.3
(`20260730010000_notify_signup_trigger.sql`) already wired a database trigger
that calls `notify-signup` directly whenever a `profiles` row is inserted.

Verify: sign up with any real email address in the app, then check
`tal.yoeli@gmail.com` (and spam folder) for a "New sign-up" email within a
minute or two. If nothing arrives, confirm step 1.3's third migration ran
(check **Database → Extensions** for `pg_net` enabled) and that
`RESEND_API_KEY` is set (step 1.2).

### 1.6 Disable anonymous sign-ins

The opposite of the previous stage's setup — real accounts now exist, so the
anonymous fallback is no longer needed and should not stay enabled.

1. **Authentication** → **Providers** → find **Anonymous sign-ins** → disable it.

### 1.7 Confirm "Confirm email" is enabled (it's Supabase's default — just check)

1. **Authentication** → **Providers** → **Email** → confirm **Confirm email**
   is turned on.

This makes a signup prove it owns the email address it registered with,
independent of and before your approval decision.

### 1.8 Set an OpenAI spending limit

Defence in depth behind the 60/day per-device quota.

1. platform.openai.com → **Settings** → **Billing** → **Limits**.
2. Set a hard monthly cap you are comfortable with.

### 1.9 Restrict CORS once the domain is known

Until you set this, the functions accept requests from any origin (the
behaviour the iPhone-only build shipped with). The JWT, approval, and quota
checks still apply, so this is hardening rather than the primary control.

```powershell
npx supabase secrets set ALLOWED_ORIGINS=https://your-site.pages.dev,http://localhost:8081
```

Then redeploy the affected functions again (step 1.4).

Verify: from a different site's console, `fetch` to a function is blocked by
the browser with a CORS error; your own site keeps working.

---

## 2. Hosting

Any static host works. The only requirement is a **single-page rewrite**, so
every path serves `index.html`.

### Cloudflare Pages (recommended)

1. Push this repository to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick the repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build:web`
   - Build output directory: `dist`
4. **Settings → Environment variables** (Production *and* Preview):

   | Name | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | `https://gxawhrkctjhneasimoek.supabase.co` |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | your anon key |

   These are compiled into the bundle at build time, so changing one requires a
   **rebuild**, not just a restart. Both are public values by design.
5. Add `dist/_redirects` handling by creating a file `public/_redirects`
   containing `/*  /index.html  200`, or set the equivalent rule in the
   dashboard.
6. Deploy.

### Netlify

Same build command and output directory. Add `netlify.toml`:

```toml
[build]
  command = "npm run build:web"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Vercel

Build command `npm run build:web`, output directory `dist`, framework "Other",
and a rewrite of `/(.*)` to `/index.html`.

### Caching

- `/_expo/static/*` — immutable, `max-age=31536000`. Filenames are content
  hashed, so this is safe.
- `index.html` — `no-cache`, so a new deploy is picked up immediately.

### HTTPS

Required, not optional: the microphone and camera APIs refuse to run on an
insecure origin. All three hosts above provide HTTPS automatically.
`http://localhost` is exempt during development.

---

## 3. Local development

```powershell
npm install
npm run web          # browser, http://localhost:8081
npm run start:lan    # iPhone through Expo Go, unchanged
```

`.env` is read by Expo automatically:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

`OPENAI_API_KEY` and `RESEND_API_KEY` stay only in Supabase secrets and are
never added to `.env`.

Note: **local development still requires a real account and approval.** Sign
up with your own email, approve yourself the same way any other user would be
approved (via the emailed link, or directly in Table Editor), and sign in
normally.

To preview the production bundle exactly as it will be served:

```powershell
npm run build:web
npm run serve:web    # http://localhost:3000
```

## 4. Checks before deploying

```powershell
npm run typecheck      # must be clean
npm run test:learning  # 24 tests
npm run build:web      # must succeed
npm run build:ios      # proves the mobile app still builds
```

Then confirm no private secret reached the bundle:

```powershell
Select-String -Path dist\_expo\static\js\web\*.js -Pattern "sk-","service_role","OPENAI_API_KEY"
```

Expected: no matches. The Supabase URL and anon key *will* appear — they are
public by design.

---

## 5. Rollback

**Web:** every deploy on Cloudflare Pages, Netlify, and Vercel is immutable.
Open the deployments list, pick the previous one, and promote it to production.
This is atomic and takes effect immediately.

**Edge Functions:** check out the previous git tag and redeploy all seven:

```powershell
git checkout pre-web-migration
npx supabase functions deploy analyze-learning-material
# ...and the other six
```

**Database:** every change so far is additive. Drop `ai_usage`,
`consume_ai_quota()`, `handle_new_user()`, the `on_auth_user_created` trigger,
and the `approved`/`approval_token` columns (SQL in steps 1.3's rollback and
the earlier migration) and the project returns to its former state. No
learner data is stored server-side, so nothing can be lost.

**Locking everyone out by mistake:** if you disable anonymous sign-ins (step
1.6) before real accounts exist and approved, nobody — including you — can get
past the sign-in screen. Approve at least one account (yourself) before
treating this as the only way in.

**Mobile:** the iPhone app is unaffected by any web deploy. `git checkout
pre-web-migration` restores the exact pre-migration source.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-up succeeds but you never get an email | Database Webhook not created, or Resend key missing | Steps 1.2 and 1.5 |
| "Your account has not been approved yet" forever, even after clicking Approve | You clicked the emailed link but never pressed the **Approve** button on the page it opened | GET only shows a confirmation page by design; the button's click is what approves |
| Approve link says "Link no longer valid" | Already used (token rotates on approval) or the account was never created | Sign up again, or check `profiles` in Table Editor |
| AI features return "Sign-in is required" | Not signed in, or the session expired | Sign in again |
| "The usage quota function is missing" | Migrations not applied | Step 1.3 |
| "Daily AI limit reached (60 requests)" | Quota exhausted for that account today | Wait for UTC midnight, or raise `daily_limit` in the migration and re-run it |
| Nobody, including you, can sign in | Anonymous sign-ins disabled before any account was approved | Approve your own account directly in Table Editor: set `approved = true` on your `profiles` row |
| Blank page, 404 on refresh of a sub-path | No SPA rewrite | Add the `/* -> /index.html 200` rule |
| Microphone button does nothing | Page not served over HTTPS | Deploy behind HTTPS; `localhost` is exempt |
| Voice playback silent in Firefox only | Edge Functions predate the MP3 format parameter | Redeploy `synthesize-speech` (step 1.4) |
| Recording fails with "unsupported audio format" | Unusual browser MediaRecorder codec | Use Chrome, Edge, or Safari |
| "Supabase is not configured" | `EXPO_PUBLIC_*` variables missing at build time | Set them in the host and rebuild |
| Web shows an empty library | Browser storage is separate from the phone | Export a backup on the phone, import the file in the browser |
