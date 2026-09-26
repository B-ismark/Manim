# Deploying Manim (Cloudflare Workers + Static Assets)

Manim is a Vite SPA served by a Cloudflare **Worker** (`worker/index.js`) that
also routes `/api/*` to the shared orchestration core (`server/core.mjs`) — the
same logic the local Express dev server uses. LiveKit Cloud is the SFU; Supabase
powers accounts + presence; Resend (optional) sends email invites.

Config lives in `wrangler.toml` (Worker entry + `[assets]` for the built site +
`nodejs_compat`). Deploy runs `npx wrangler deploy`.

## 0. Deploy flow — READ THIS FIRST (how to actually ship)

Cloudflare Workers Builds is git-connected with **two** commands:
- **Production branch = `main`** → runs **`npx wrangler deploy`** → goes **live**.
- **Any other branch** → runs **`npx wrangler versions upload`** → creates a
  **preview** version + a `<branch>-manim.i-ai.workers.dev` URL, but **does NOT
  touch production**.

So **to ship: merge to `main` and push.** Work pushed to a feature branch builds
and previews but will *never* appear on the live URL — that mismatch caused real
confusion once. Develop on `main` (or merge promptly); don't sit on long-lived
feature branches expecting production to update.

**Never `wrangler deploy` from a dev machine.** The `VITE_*` values
(`VITE_LIVEKIT_URL`, Supabase, Giphy, annotation) live **only** in Cloudflare → Settings →
Build → Variables. A local `.env` is intentionally empty, so a local build bakes
an empty `VITE_LIVEKIT_URL`; `LIVEKIT_URL` then folds to falsy, the entire
in-call UI becomes dead code and is tree-shaken out, and you ship a bundle that
builds fine but can't run a call. `vite.config.ts` now **hard-fails** a build
with an empty `VITE_LIVEKIT_URL` to stop this. Let Cloudflare build.

If a good version was uploaded but isn't live (e.g. built on a branch), promote
it without rebuilding: `npx wrangler versions deploy <version-id>@100% --yes`
(or the dashboard → Deployments → Promote). Roll back a bad deploy with
`npx wrangler rollback <version-id>`.

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
| `VITE_SENTRY_DSN` | build | optional | Crash reports. Unset = reporting stays in the browser console. Setup below (§3c). |
| `VITE_ANNOTATE` | build | optional | Draw-on-shared-screen. **Inverted — unset means ON.** Set to exactly `false` to disable it without a code change. |

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

### 3c. Crash reports (Sentry, optional)
The app loads Sentry through its **Loader Script** only when `VITE_SENTRY_DSN` is
set, and strips every room link's `#fragment` (join secret + E2EE key) from each
report before it leaves the browser (`src/lib/report.ts`). The Worker's CSP
already allows the two script hosts the loader needs (`js.sentry-cdn.com`,
`browser.sentry-cdn.com`); reports go to `*.ingest.sentry.io`, inside `connect-src`.

1. **sentry.io → Create project → Platform: Browser JavaScript** (not Next.js —
   this is a Vite app; React also works). Under Products leave only Error
   monitoring; don't tick Session replay, Tracing, Profiling, Logging or Metrics.
   Name it `manim`. Skip the install instructions Sentry shows afterwards: the app
   already has the code. Pick the data region you want (EU keeps reports in
   Frankfurt; the Privacy page lists Sentry either way).
2. **Project Settings → Loader Script**: keep the SDK version on the latest 8.x or
   newer, and switch **off Session Replay** and **Performance Monitoring
   (tracing)**. Replay records the page — names, chat, the call UI — which the
   Privacy page does not disclose and the scrubber does not cover.
3. **Project Settings → Security & Privacy**: turn on **Data Scrubber**,
   **Use Default Scrubbers** and **Prevent Storing of IP Addresses**. Leave
   *Additional Sensitive Fields* empty: it matches any field name that CONTAINS the
   entry, so `e` or `k` there would blank almost every field. Instead, as a
   server-side backstop, **Advanced Data Scrubbing → Add Rule**: Method *Replace*
   (placeholder `[room-secret]`), Data Type *Regex Matches*, Regex
   `(?:[#?&]|%23|%3F|%26)(?:k|e|[a-z_]*token)(?:=|%3D)[^&\s"'#%]+`,
   Source `$string`. (The `?` matters: livekit-client puts the call's join token in
   a query string, `?access_token=…`, when it checks a failed connection.)
4. **Project Settings → Client Keys (DSN)**: copy the DSN
   (`https://<key>@o<org>.ingest<region>.sentry.io/<project>`).
5. **Cloudflare → the Worker → Settings → Build → Variables and secrets**: add
   `VITE_SENTRY_DSN` = that DSN (a *build* variable — it is baked into the bundle;
   a DSN is public by design). Then push to `main` (or retry the latest build) so
   the bundle is rebuilt with it.
6. **Verify on the deployed site**, not the build: DevTools → Network shows
   `js.sentry-cdn.com/<key>.min.js` loading with no CSP error in the Console. Run
   `window.Sentry.captureMessage('manim sentry check')` in the Console on a room
   page opened from an encrypted link, confirm the event reaches Sentry, and open
   it to check the URLs carry no `#k=` / `#e=`.

## 4. Supabase setup (accounts + presence)
1. **Authentication → Providers → Email**: enable. (Magic links work on the free
   tier out of the box.)
2. **Authentication → URL Configuration**: add your Worker URL to the redirect
   allow-list (e.g. `https://manim.i-ai.workers.dev`, plus any custom domain).
   Magic-link AND Google sign-in fail silently if the URL isn't allow-listed.

   **Google sign-in (optional, recommended — one tap, carries across devices):**
   - **Google Cloud Console** → create an OAuth 2.0 Client ID (Web application).
     Authorized redirect URI = `https://<your-project>.supabase.co/auth/v1/callback`
     (shown in the Supabase Google provider page).
   - **Supabase → Authentication → Providers → Google**: enable, paste the client
     ID + secret. No app code change needed — the "Continue with Google" button is
     already wired (`signInWithOAuth`). Without this, the button errors and users
     fall back to the magic link.
3. **SQL editor** → run, so users are reachable by email for calls:

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  avatar_url text
);
-- Existing installs: add the columns without recreating the table.
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists avatar_url text;
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

#### 3.1 Rate-limit the email lookup (run once — added 2026-09)
`lookup_profile_id` answers "does this email have a Manim account?" for any
signed-in caller, so without a limit it can check a whole list of addresses. This
replaces it with the same lookup, throttled to **30 lookups per 10 minutes per
account**. A throttled call raises `rate_limited`, which the app shows as "Too many
lookups — try again in a few minutes." Safe to re-run.

```sql
create table if not exists lookup_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  ts timestamptz not null default now()
);
create index if not exists lookup_attempts_user_ts on lookup_attempts (user_id, ts);
alter table lookup_attempts enable row level security; -- no policies: only the function touches it

create or replace function lookup_profile_id(lookup_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  if uid is null then return null; end if;
  -- One caller at a time per user: without it, parallel calls each count the same
  -- committed rows and all pass, so a burst of 500 at once would bypass the cap.
  perform pg_advisory_xact_lock(hashtext('lookup_profile_id'), hashtext(uid::text));
  delete from lookup_attempts where user_id = uid and ts < now() - interval '10 minutes';
  select count(*) into recent from lookup_attempts where user_id = uid;
  if recent >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into lookup_attempts (user_id) values (uid);
  return (select id from profiles where email = lower(lookup_email) limit 1);
end;
$$;
revoke all on function lookup_profile_id(text) from public;
grant execute on function lookup_profile_id(text) to authenticated;
```

### 3a. Avatars (profile photos)
Profile photos are uploaded to a **public Storage bucket** (downscaled to a small
square webp client-side first, so objects stay a few KB), and the resulting public
URL is saved to `profiles.avatar_url`. Google sign-ins are seeded with the
provider photo automatically — no upload needed. Without this bucket the app still
runs: avatars just fall back to coloured initials and the upload button errors.

1. **Storage → New bucket**: name `avatars`, **Public** ✅ (public read so the
   `<img>` and the cross-device sync work via the CDN URL).
2. **SQL editor** → RLS so a user can only write **their own** `${uid}/…` objects
   (public read is already granted by the bucket being public):

```sql
create policy "avatar upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- Added 2026-09 (run once): Storage's remove() needs SELECT as well as DELETE, so
-- without this, replacing or removing a photo (and deleting the account) silently
-- left the old one public. Scoped to your own folder, so nobody can list anyone else's.
create policy "avatar read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
```

The client uploads to `avatars/<user-id>/<random>.webp`, a new random name each
time (the old one is deleted), so the folder-name check pins each user to their own
prefix. The name is random because the bucket is public and account ids are seen by
everyone in a call: a fixed `avatar.webp` let anyone who had your id open your
photo. Don't add a public `select` policy on `storage.objects` for this bucket —
that would let anyone list the folder and undo it.

### 3b. Self-serve account deletion
The app's **Settings → Delete account** button (privacy requirement) calls a
`delete_account()` RPC. It removes the caller's own `auth.users` row; the
`on delete cascade` foreign keys on `profiles`, `contacts`, and
`push_subscriptions` take all their data with it. SECURITY DEFINER is required
because deleting from `auth.users` is privileged — but it only ever deletes
`auth.uid()` (the caller), so it can't be used to delete anyone else. Without
this function the button errors; everything else still works.

```sql
create or replace function delete_account()
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function delete_account() from public;
grant execute on function delete_account() to authenticated;
```

4. **Contacts** (optional — powers the consent-based contacts list + call-a-contact).
   Run in the SQL editor:

```sql
-- One directed row per relationship: requester → addressee, with a status.
-- 'pending' = awaiting the addressee's agreement; 'accepted' = mutual contact.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester <> addressee),
  unique (requester, addressee)
);
alter table contacts enable row level security;

-- You can see any row you're a party to.
create policy "read own contacts" on contacts for select
  using (auth.uid() = requester or auth.uid() = addressee);
-- You can only send a request AS yourself.
create policy "send own request" on contacts for insert
  with check (auth.uid() = requester);
-- Only the addressee can accept (flip pending → accepted on their own row).
create policy "addressee accepts" on contacts for update
  using (auth.uid() = addressee) with check (auth.uid() = addressee);
-- Either party can remove the relationship (decline / cancel / unfriend).
create policy "either removes" on contacts for delete
  using (auth.uid() = requester or auth.uid() = addressee);

-- Joined read with names/emails/avatars. profiles isn't publicly readable, so
-- this SECURITY DEFINER fn does the join — but only ever returns rows where the
-- caller is one of the two parties, so it can't dump the table.
-- Drop first: adding the other_avatar column changes the return type, which
-- `create or replace` can't do on its own.
drop function if exists list_contacts();
create or replace function list_contacts()
returns table (other_id uuid, other_email text, other_name text, other_avatar text, status text, direction text)
language sql
security definer
set search_path = public
as $$
  select
    case when c.requester = auth.uid() then c.addressee else c.requester end,
    p.email,
    p.display_name,
    p.avatar_url,
    c.status,
    case
      when c.status = 'accepted' then 'accepted'
      when c.requester = auth.uid() then 'outgoing'
      else 'incoming'
    end
  from contacts c
  join profiles p
    on p.id = case when c.requester = auth.uid() then c.addressee else c.requester end
  where auth.uid() = c.requester or auth.uid() = c.addressee
  order by c.updated_at desc;
$$;
revoke all on function list_contacts() from public;
grant execute on function list_contacts() to authenticated;
```

4b. **Contacts hardening + Realtime privacy** (run AFTER §4 — closes the audit
    findings: reciprocal-add race, client-clock ordering, and the unauthenticated
    ring/presence channels). **Required for calling once deployed** — the client
    now uses private channels + the `ring` RPC; without these policies, incoming
    calls won't be received.

```sql
-- (1) Canonical single-row-per-pair: blocks BOTH (A,B) and (B,A) coexisting,
-- which the old same-direction unique couldn't. Drop the old constraint first.
alter table contacts drop constraint if exists contacts_requester_addressee_key;
create unique index if not exists contacts_pair_uniq
  on contacts (least(requester, addressee), greatest(requester, addressee));

-- (2) Server-owned updated_at so list ordering uses one clock, not the client's.
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists contacts_touch on contacts;
create trigger contacts_touch before update on contacts
  for each row execute function touch_updated_at();

-- (3) Atomic add: insert a request, or accept the reverse one if it already
-- exists — race-safe (the unique index + exception handler converge instead of
-- creating reciprocal-pending rows). Returns a status string for the UI.
create or replace function add_contact(addressee_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing contacts;
begin
  if me is null then return 'unauthenticated'; end if;
  if addressee_id = me then return 'self'; end if;
  select * into existing from contacts
    where (requester = me and addressee = addressee_id)
       or (requester = addressee_id and addressee = me)
    limit 1;
  if found then
    if existing.status = 'accepted' then return 'already'; end if;
    if existing.requester = addressee_id then
      update contacts set status = 'accepted' where id = existing.id;
      return 'accepted';
    end if;
    return 'pending';
  end if;
  insert into contacts(requester, addressee) values (me, addressee_id);
  return 'requested';
exception when unique_violation then
  -- A reverse row landed between our select and insert — accept it if it's theirs.
  select * into existing from contacts
    where (requester = me and addressee = addressee_id)
       or (requester = addressee_id and addressee = me)
    limit 1;
  if found and existing.requester = addressee_id and existing.status = 'pending' then
    update contacts set status = 'accepted' where id = existing.id;
    return 'accepted';
  end if;
  return 'pending';
end $$;
revoke all on function add_contact(uuid) from public;
grant execute on function add_contact(uuid) to authenticated;

-- (4) Ring a contact server-side: verifies the caller is an ACCEPTED contact of
-- the target, then broadcasts into the target's PRIVATE user channel. The sender
-- never joins the target's channel (no harvest), and non-contacts can't ring.
create or replace function ring(target_id uuid, room text, from_name text)
returns text language plpgsql security definer set search_path = public, realtime as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'unauthenticated'; end if;
  if not exists (
    select 1 from contacts c where c.status = 'accepted'
      and ((c.requester = me and c.addressee = target_id)
        or (c.addressee = me and c.requester = target_id))
  ) then return 'not_contact'; end if;
  perform realtime.send(
    jsonb_build_object('room', room, 'fromName', from_name),
    'ring', 'user:' || target_id::text, true);
  return 'ok';
end $$;
revoke all on function ring(uuid, text, text) from public;
grant execute on function ring(uuid, text, text) to authenticated;

-- (4b) Ring overload that ALSO relays the invite-link secrets (the join secret and
-- E2EE key) into the ring payload, so a called contact can pass the room's
-- join-secret gate and key end-to-end encryption. Kept as a SEPARATE overload from
-- the 3-arg ring() above so a client mid-rollout keeps working. REQUIRED for ringing
-- a contact into a secured room (room access hardening) — deploy this BEFORE the app
-- build that calls it. The same Realtime RLS as (5) gates who can receive.
create or replace function ring(target_id uuid, room text, from_name text, join_secret text, e2ee_key text)
returns text language plpgsql security definer set search_path = public, realtime as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'unauthenticated'; end if;
  if not exists (
    select 1 from contacts c where c.status = 'accepted'
      and ((c.requester = me and c.addressee = target_id)
        or (c.addressee = me and c.requester = target_id))
  ) then return 'not_contact'; end if;
  perform realtime.send(
    jsonb_build_object('room', room, 'fromName', from_name, 'secret', join_secret, 'e2ee', e2ee_key),
    'ring', 'user:' || target_id::text, true);
  return 'ok';
end $$;
revoke all on function ring(uuid, text, text, text, text) from public;
grant execute on function ring(uuid, text, text, text, text) to authenticated;

-- (5) Realtime Authorization: you may only RECEIVE on your own user:/presence:
-- channel (kills online-harvest), and only WRITE to your own presence or — via
-- the SECURITY DEFINER ring() above — to a contact. Direct client broadcast to
-- someone else's channel is denied.
alter table realtime.messages enable row level security;

create policy "receive own channel" on realtime.messages for select to authenticated
  using (
    (realtime.topic() like 'user:%' or realtime.topic() like 'presence:%')
    and split_part(realtime.topic(), ':', 2) = auth.uid()::text
  );

create policy "write own presence" on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'presence:%'
    and split_part(realtime.topic(), ':', 2) = auth.uid()::text
  );
```

4c. **Background Web Push** (optional — true mobile / backgrounded / closed-tab
    incoming-call notifications, on top of the foreground in-app banner). Needs the
    VAPID env vars below. Run:

```sql
-- One row per browser push endpoint, owned by the subscriber.
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "own subs read"   on push_subscriptions for select using (auth.uid() = user_id);
create policy "own subs insert" on push_subscriptions for insert with check (auth.uid() = user_id);
create policy "own subs update" on push_subscriptions for update using (auth.uid() = user_id);
create policy "own subs delete" on push_subscriptions for delete using (auth.uid() = user_id);

-- Return a target's push subscriptions ONLY to one of their accepted contacts, so
-- the push sender (the Worker) can fan out using the CALLER's token — no service
-- role key, and endpoints aren't exposed to non-contacts.
create or replace function get_push_targets(target_id uuid)
returns table (endpoint text, p256dh text, auth text)
language sql security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth from push_subscriptions s
  where s.user_id = target_id and exists (
    select 1 from contacts c where c.status = 'accepted'
      and ((c.requester = auth.uid() and c.addressee = target_id)
        or (c.addressee = auth.uid() and c.requester = target_id))
  );
$$;
revoke all on function get_push_targets(uuid) from public;
grant execute on function get_push_targets(uuid) to authenticated;

-- Added 2026-09 (run once, needs pg_cron — see §4d): subscriptions the browser has
-- dropped (404/410 from the push service) were never deleted, so every ring kept
-- paying for them. A device renews its row on every app start (upsert, and the
-- trigger stamps the server's clock); rows nobody renewed in 60 days are dropped.
-- Only the owner could delete them otherwise, which is why this runs in Supabase.
alter table push_subscriptions add column if not exists seen_at timestamptz not null default now();
create or replace function push_seen() returns trigger
  language plpgsql as $$ begin new.seen_at = now(); return new; end $$;
drop trigger if exists push_subscriptions_seen on push_subscriptions;
create trigger push_subscriptions_seen before insert or update on push_subscriptions
  for each row execute function push_seen();
```

**VAPID keys** — generate one keypair: `npx web-push generate-vapid-keys`.
- Client/build var (Cloudflare → manim → Build): `VITE_VAPID_PUBLIC_KEY` = the public key.
- Worker runtime vars (Worker → Settings → Variables): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` as a **Secret** (e.g. `mailto:you@domain.com`: push services use it to reach you about problems; a Secret because this repo is public; unset, it falls back to the repo's URL), plus `SUPABASE_URL` + `SUPABASE_ANON_KEY` (the push sender calls the `get_push_targets` RPC). Without these the push endpoint is a graceful no-op and only the in-app banner shows.
- iOS note: Web Push needs the PWA installed to the Home Screen (Add to Home Screen) — Safari only delivers push to installed web apps.

4d. **Contact requests and dead push subscriptions expire** (run once — added
    2026-09, after the §4c addition above). A request nobody answers used to sit in
    both people's lists forever; this drops unanswered ones after 30 days, and push
    subscriptions no device has renewed in 60, nightly, inside Supabase (`pg_cron` is on the free plan:
    Database → Extensions → enable **pg_cron** first if the `create extension`
    line errors).

```sql
create extension if not exists pg_cron;
select cron.schedule(
  'expire-push-subscriptions',
  '41 3 * * *',
  $$delete from public.push_subscriptions where seen_at < now() - interval '60 days'$$
);
select cron.schedule(
  'expire-contact-requests',
  '23 3 * * *',
  $$delete from public.contacts where status = 'pending' and created_at < now() - interval '30 days'$$
);
```

4e. **Sealed call keys** (run once — added 2026-09, after §4c and §4d). A ring
    and the "you're in a call on another device" offer both carry the room's join
    secret and E2EE key, and until now they crossed Supabase Realtime readable to
    anyone who could read that traffic. Each signed-in browser now keeps its own
    keypair (the private half never leaves the browser) and publishes the public
    half here; a caller seals the secrets to the callee's devices so only those
    devices can open them. Until this is run, or for someone whose devices haven't
    registered yet, the app sends the secrets the old way, so ringing never breaks.
    What this protects against: anyone reading the stored rings or Realtime
    traffic. It does NOT protect against Supabase itself acting maliciously, since
    Supabase also serves the public keys a caller seals to.

```sql
-- One public key per signed-in browser. The private half stays in the browser.
create table if not exists device_keys (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 64),
  -- A P-256 public key is ~200 bytes; the cap keeps anyone from making their
  -- callers download (and run crypto over) something huge.
  public_key jsonb not null check (pg_column_size(public_key) < 512 and public_key ? 'x' and public_key ? 'y'),
  seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table device_keys enable row level security;
create policy "own keys read"   on device_keys for select using (auth.uid() = user_id);
create policy "own keys insert" on device_keys for insert with check (auth.uid() = user_id);
create policy "own keys update" on device_keys for update using (auth.uid() = user_id);
create policy "own keys delete" on device_keys for delete using (auth.uid() = user_id);
-- Reuses §4c's trigger function: every sign-in renews the row's seen_at.
drop trigger if exists device_keys_seen on device_keys;
create trigger device_keys_seen before insert or update on device_keys
  for each row execute function push_seen();

-- Public keys for yourself (your other devices) or an accepted contact only, the
-- 10 most recently signed-in browsers at most.
create or replace function get_device_keys(target_id uuid)
returns table (device_id text, public_key jsonb)
language sql security definer set search_path = public as $$
  select k.device_id, k.public_key from device_keys k
  where k.user_id = target_id and (target_id = auth.uid() or exists (
    select 1 from contacts c where c.status = 'accepted'
      and ((c.requester = auth.uid() and c.addressee = target_id)
        or (c.addressee = auth.uid() and c.requester = target_id))
  ))
  order by k.seen_at desc limit 10;
$$;
revoke all on function get_device_keys(uuid) from public, anon;
grant execute on function get_device_keys(uuid) to authenticated;

-- A browser not signed in for 90 days stops being sealed to.
select cron.schedule(
  'expire-device-keys',
  '53 3 * * *',
  $$delete from public.device_keys where seen_at < now() - interval '90 days'$$
);
```

4f. **Recent calls on every device** (run once — added 2026-09, after §4e). The
    home screen's "Recent calls" list used to live only in the browser that made
    the call, so calls from your phone never showed on your laptop. A signed-in
    account now also keeps the list here: the room name, its display name and when
    you were last in it. The join secret and E2EE key are sealed to your
    registered devices (§4e), so this table holds ciphertext for them, never the
    keys. Until this is run the list stays per-browser, exactly as before.

```sql
create table if not exists recent_calls (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null check (length(slug) between 1 and 128),
  name text not null default '' check (length(name) <= 200),
  -- sealed1:… from lib/sealedSecrets, one entry per device (at most 10).
  sealed text check (sealed is null or length(sealed) <= 16000),
  e2ee boolean not null default false,
  last_at timestamptz not null default now(),
  primary key (user_id, slug)
);
alter table recent_calls enable row level security;
create policy "own recents read"   on recent_calls for select using (auth.uid() = user_id);
create policy "own recents insert" on recent_calls for insert with check (auth.uid() = user_id);
create policy "own recents update" on recent_calls for update using (auth.uid() = user_id);
create policy "own recents delete" on recent_calls for delete using (auth.uid() = user_id);

-- Same 30 days the list keeps locally.
select cron.schedule(
  'expire-recent-calls',
  '41 3 * * *',
  $$delete from public.recent_calls where last_at < now() - interval '30 days'$$
);
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

Verify config at runtime from the Landing page **Setup** menu — open the site with
`?setup` on the address (`https://…/?setup`); visitors never see it. It reports which
of LiveKit / accounts / email / GIFs are live (green) or missing (with the env
var to set). A red banner appears if calls aren't configured (for visitors it just
says calls aren't available right now).

## Local development
`npm run dev` runs Vite (5173) + the Express dev server (3001) which mirrors the
Function via `server/core.mjs`. Copy `.env.example` → `.env` and fill values.
