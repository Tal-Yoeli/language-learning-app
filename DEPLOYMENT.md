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

### 1.1 Enable anonymous sign-ins

Without this, every AI feature returns a 401 once the new Edge Functions are
deployed, because the per-device quota needs a real `auth.uid()`.

1. Open the Supabase dashboard → your project → **Authentication** → **Providers**.
2. Find **Anonymous sign-ins** and enable it.
3. Save.

Expected result: the toggle stays on after a page refresh.
Verify: open the deployed site, use any AI feature, and check
**Authentication → Users** for a new user with **Is anonymous** = true.

### 1.2 Apply the quota migration

1. Open **SQL Editor** in the Supabase dashboard.
2. Paste the whole contents of
   `supabase/migrations/20260728000000_ai_usage_quota.sql` and run it.
   (Or run `npx supabase db push` if you prefer the CLI.)

Expected result: `Success. No rows returned`.
Verify: **Table Editor** shows a new `ai_usage` table with RLS enabled. Nothing
else changed — the migration only creates, never alters or drops.

Rollback:

```sql
drop function if exists public.consume_ai_quota();
drop table if exists public.ai_usage;
```

### 1.3 Redeploy all five Edge Functions

Required: each function bundles its own copy of `_shared/`, so a change there
only takes effect after every function is redeployed.

```powershell
npx supabase functions deploy analyze-learning-material
npx supabase functions deploy generate-themed-deck
npx supabase functions deploy evaluate-translation
npx supabase functions deploy pronunciation-feedback
npx supabase functions deploy synthesize-speech
```

Expected result: `Deployed Function on project gxawhrkctjhneasimoek` for each.
Verify: use an AI feature in the app; then check `ai_usage` — your row's
`request_count` should have increased by one.

If a function reports the project is `INACTIVE`, resume the project in the
dashboard first.

### 1.4 Set an OpenAI spending limit

Defence in depth behind the 60/day per-device quota.

1. platform.openai.com → **Settings** → **Billing** → **Limits**.
2. Set a hard monthly cap you are comfortable with.

### 1.5 Restrict CORS once the domain is known

Until you set this, the functions accept requests from any origin (the
behaviour the iPhone-only build shipped with). The JWT and quota checks still
apply, so this is hardening rather than the primary control.

```powershell
npx supabase secrets set ALLOWED_ORIGINS=https://your-site.pages.dev,http://localhost:8081
```

Then redeploy the five functions again (step 1.3).

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

`OPENAI_API_KEY` stays only in Supabase secrets and is never added to `.env`.

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

**Edge Functions:** check out the previous git tag and redeploy all five:

```powershell
git checkout pre-web-migration
npx supabase functions deploy analyze-learning-material
# ...and the other four
```

**Database:** the only change is additive. Drop `ai_usage` and
`consume_ai_quota()` (SQL in section 1.2) and the project returns to its former
state. No learner data is stored server-side, so nothing can be lost.

**Mobile:** the iPhone app is unaffected by any web deploy. `git checkout
pre-web-migration` restores the exact pre-migration source.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| AI features return "Sign-in is required" | Anonymous sign-ins are still disabled | Step 1.1 |
| "The usage quota function is missing" | Migration not applied | Step 1.2 |
| "Daily AI limit reached (60 requests)" | Quota exhausted for that device today | Wait for UTC midnight, or raise `daily_limit` in the migration and re-run it |
| Blank page, 404 on refresh of a sub-path | No SPA rewrite | Add the `/* -> /index.html 200` rule |
| Microphone button does nothing | Page not served over HTTPS | Deploy behind HTTPS; `localhost` is exempt |
| Voice playback silent in Firefox only | Edge Functions predate the MP3 format parameter | Redeploy `synthesize-speech` (step 1.3) |
| Recording fails with "unsupported audio format" | Unusual browser MediaRecorder codec | Use Chrome, Edge, or Safari |
| "Supabase is not configured" | `EXPO_PUBLIC_*` variables missing at build time | Set them in the host and rebuild |
| Web shows an empty library | Browser storage is separate from the phone | Export a backup on the phone, import the file in the browser |
