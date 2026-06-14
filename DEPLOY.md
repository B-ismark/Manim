# Deploying Manim (Cloudflare Workers + Static Assets)

Manim is a Vite SPA served by a Cloudflare **Worker** (`worker/index.js`) that
also routes `/api/*` to the shared orchestration core (`server/core.mjs`) — the
same logic the local Express dev server uses. LiveKit Cloud is the SFU; Supabase
powers accounts + presence; Resend (optional) sends email invites.

Config lives in `wrangler.toml` (Worker entry + `[assets]` for the built site +
`nodejs_compat`). Deploy runs `npx wrangler deploy`.

## 1. Push is already set up
The repo lives at `github.com/B-ismark/Manim`. Cloudflare builds from it.

## 2. Create the Worker (Git-connected)
1. Cloudflare dashboard → **Workers & Pages → Create → Workers → Import a repository**.
2. Pick the `Manim` repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (default)
4. `wrangler.toml` supplies the Worker entry, the `dist` assets dir, SPA fallback,
   and the `nodejs_compat` flag — no extra config needed.

## 3. Environment variables
`VITE_*` are baked into the client **at build time**, so set them as **build
variables**. The rest are read by the Worker **at runtime**, so set them as
**runtime variables / secrets**. (Cloudflare → your Worker → Settings → Variables;
build vars live under the Build section.)

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `VITE_LIVEKIT_URL` | build + runtime* | ✅ | `wss://<project>.livekit.cloud` (*Worker reads it too, to call LiveKit) |
| `LIVEKIT_API_KEY` | runtime | ✅ | LiveKit Cloud key (server-only) |
| `LIVEKIT_API_SECRET` | runtime (secret) | ✅ | LiveKit Cloud secret (server-only) |
| `VITE_SUPABASE_URL` | build | for accounts | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | build | for accounts | Supabase anon key |
| `RESEND_API_KEY` | runtime (secret) | optional | real email invites (else mailto) |
| `RESEND_FROM` | runtime | optional | e.g. `Manim <onboarding@resend.dev>` |
| `VITE_GIPHY_KEY` | build | optional | GIF picker (free key from developers.giphy.com) |

> Set `VITE_LIVEKIT_URL` in **both** build and runtime (the client connects with
> it; the Worker uses it to reach the LiveKit RoomService).
> Never set `LIVEKIT_API_SECRET` / `RESEND_API_KEY` as `VITE_*` — that ships them
> to the browser.

### 3a. Build vars vs runtime vars — they are NOT the same panel
This trips everyone up. There are **two** "Variables and secrets" sections:

| Panel | Where | Available | Use for |
|---|---|---|---|
| **Build** | Settings → **Build** → Variables and secrets | only during `npm run build` | `VITE_*` (baked into the bundle) |
| **Runtime** | Settings → Variables and secrets ("used at runtime") | when the Worker handles a request | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `RESEND_API_KEY` |

If you put `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in the **Build** panel, the
Worker can't read them at runtime and minting fails with **"LIVEKIT keys not
set"**. They belong in the **Runtime** panel, as **Secret** type.

Two more gotchas:
- **A plain-text runtime var set only in the dashboard is dropped on the next
  `wrangler deploy`** (wrangler.toml is the source of truth for `[vars]`). So
  non-secret runtime values (`VITE_LIVEKIT_URL`, `RESEND_FROM`) live in
  `wrangler.toml [vars]`, and only **Secrets** (encrypted) are set in the
  dashboard — Secrets survive deploys.
- The new-variable dialog has **Deploy** and **Save version**. **Save version
  does NOT go live** — it only stages a version. Always click **Deploy** (or let
  a `git push` run `wrangler deploy`, which deploys to 100%).

## 4. Supabase setup (accounts + presence)
1. **Authentication → Providers → Email**: enable. (Magic links work on the free
   tier out of the box.)
2. **Authentication → URL Configuration**: add your Worker URL to the redirect
   allow-list (e.g. `https://manim.i-ai.workers.dev`, plus any custom domain).
   Magic-link sign-in fails silently if the URL isn't allow-listed.
3. **SQL editor** → run, so users are reachable by email for calls:

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique
);
alter table profiles enable row level security;

-- Read/write ONLY your own row. A `using (true)` select policy would let anyone
-- with the public anon key dump every user's email (harvest/enumeration).
create policy "read own profile" on profiles for select using (auth.uid() = id);
create policy "insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- Call-by-email lookup: returns a single id for an EXACT email match without
-- exposing the table. SECURITY DEFINER bypasses RLS but only ever returns one
-- row, so it can't be used to list/dump profiles. Signed-in users only.
create or replace function lookup_profile_id(lookup_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from profiles where email = lower(lookup_email) limit 1;
$$;
revoke all on function lookup_profile_id(text) from public;
grant execute on function lookup_profile_id(text) to authenticated;
```

## 5. LiveKit Cloud
Already configured for dev. The Worker needs the same key/secret/URL (step 3,
runtime). No other setup.

## 6. Deploy
Push to `main` → Cloudflare builds (`npm run build`) and deploys (`wrangler
deploy`) automatically, to 100%. Your app is live at
`https://manim.i-ai.workers.dev` (the `i-ai` part is the account workers.dev
subdomain — rename it under Workers & Pages → account settings, or add a custom
domain in the Worker → Settings → Domains & Routes).

Verify config at runtime from the Landing page **Setup** menu — it reports which
of LiveKit / accounts / email / GIFs are live (green) or missing (with the env
var to set). A red banner appears if calls aren't configured.

## Local development
`npm run dev` runs Vite (5173) + the Express dev server (3001) which mirrors the
Function via `server/core.mjs`. Copy `.env.example` → `.env` and fill values.
