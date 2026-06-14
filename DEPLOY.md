# Deploying Manim (Cloudflare Pages)

Manim is a Vite SPA + a Cloudflare Pages **Function** (`functions/api/[[path]].js`)
that wraps the shared orchestration core (`server/core.mjs`). The same core runs
locally via the Express dev server. LiveKit Cloud is the SFU; Supabase powers
accounts + presence; Resend (optional) sends email invites.

## 1. Push is already set up
The repo lives at `github.com/B-ismark/Manim`. Cloudflare Pages deploys from it.

## 2. Create the Pages project
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick the `Manim` repo.
3. Build settings:
   - **Framework preset:** None / Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. The `nodejs_compat` flag and output dir come from `wrangler.toml` automatically.
   If the SDK errors at runtime, confirm **Settings → Functions → Compatibility
   flags** includes `nodejs_compat` (production *and* preview).

## 3. Environment variables (Pages → Settings → Environment variables)
Set for **Production** (and Preview). `VITE_*` are baked into the client at build
time; the rest are read by the Function at runtime.

| Variable | Required | Notes |
|---|---|---|
| `VITE_LIVEKIT_URL` | ✅ | `wss://<project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | ✅ | LiveKit Cloud key (server-only) |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit Cloud secret (server-only) |
| `VITE_SUPABASE_URL` | for accounts | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | for accounts | Supabase anon key |
| `RESEND_API_KEY` | optional | enables real email invites (else mailto) |
| `RESEND_FROM` | optional | e.g. `Manim <onboarding@resend.dev>` |
| `VITE_TENOR_KEY` | optional | GIF picker (Tenor closed signups — use Giphy when wired) |

> Never set `LIVEKIT_API_SECRET` / `RESEND_API_KEY` as `VITE_*` — that would ship
> them to the browser.

## 4. Supabase setup (accounts + presence)
1. **Authentication → Providers → Email**: enable. (Magic links work on the free
   tier out of the box.)
2. **Authentication → URL Configuration**: add your Pages URL to the redirect
   allow-list.
3. **SQL editor** → run, so users are reachable by email for calls:

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique
);
alter table profiles enable row level security;
create policy "profiles readable" on profiles for select using (true);
create policy "insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);
```

## 5. LiveKit Cloud
Already configured for dev. The Pages Function needs the same key/secret/URL
(step 3). No other setup.

## 6. Deploy
Push to `main` → Cloudflare builds and deploys automatically. First deploy can be
triggered from the dashboard. Your app is live at `https://<project>.pages.dev`
(add a custom domain in Pages → Custom domains if you want one).

## Local development
`npm run dev` runs Vite (5173) + the Express dev server (3001) which mirrors the
Function via `server/core.mjs`. Copy `.env.example` → `.env` and fill values.
