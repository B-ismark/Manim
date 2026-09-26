# Manim: what it costs to run, and when "free" runs out

*Sept 2026. Free-plan numbers come from each vendor's official page (links at the bottom).
Per-call usage comes from reading the code. Anything marked **(assumption)** is an estimate.*

## The short version

- **One wall matters: LiveKit Cloud.** LiveKit is the video service. Every other service
  is 10 to 100 times further from its limit.
- LiveKit's free plan includes **5,000 participant-minutes a month**. A participant-minute
  is one person connected for one minute, so a 3-person, 30-minute call uses 90. That
  works out to **about 55 three-person half-hour calls a month, or roughly 13 a week.**
- **It is a hard stop.** On the free plan, once the allowance is used up, "new requests
  fail" until the month resets. Nobody can join any call. You get no bill and no warning
  in the app.
- **Video data is a second wall of about the same height:** 50 GB a month of video
  delivered to viewers. At normal quality it is reached slightly after the minutes run out.
  Calls with big tiles, screen shares or 5+ people can reach it first.
- **Test calls count too.** LiveKit adds up the allowance across *all* of an owner's free
  projects, so a separate "test" project (the setup TESTING.md recommends) takes from the
  same 5,000 minutes. That explains the "quota near limit" freeze in CLAUDE.md.
- **Next step up:** LiveKit "Ship" at **$50/month**, which includes 150,000 minutes and
  250 GB. Past that, video data (not minutes) becomes most of the bill.

Hidden breakages that aren't about volume (these break today, at any usage level):
1. **Email invites only reach the owner.** The sender is `onboarding@resend.dev`
   (wrangler.toml), which is Resend's test sender. It only delivers to the Resend
   account owner's own address.
2. **Magic-link sign-in only reaches the team, unless custom email is set up.**
   Supabase's built-in email sender only delivers to members of the project team, and
   at most 2 emails an hour. The Privacy page lists Brevo as Supabase's sender; if
   Supabase → Authentication → SMTP points at Brevo, this is already solved. Worth a
   one-minute check. Google sign-in is not affected.
3. **Supabase pauses after 1 quiet week.** When it's paused, the beta gate can't check
   who a host is (`verifySupabaseUser` fails), so **every host gets "invite-only"** and
   no one can start a call. *Now handled:* the Worker pings Supabase every Monday and
   Thursday (`scheduled` in `worker/index.js`, `[triggers]` in `wrangler.toml`).

## 1. The free limits (what "free" means for each service)

| Service | What it does for Manim | Free limit | What happens at the limit |
|---|---|---|---|
| **LiveKit Cloud** (Build plan) | Carries the audio and video | **5,000 participant-min/mo**; **50 GB/mo** downstream (video sent to viewers); 100 people connected at once; basic noise suppression included | Hard stop: new joins fail until reset. Allowance shared across all your free projects |
| **Cloudflare Workers** | Serves the site and the `/api/*` endpoints | **100,000 requests/day** (resets 00:00 UTC); 10 ms CPU per request | Error / **429 for the whole site**, because every file goes through the Worker (see §2) |
| **Cloudflare KV** | Stores link expiry and the beta allowlist | 100,000 reads/day; **1,000 writes/day**; 1,000 deletes/day; 1,000 lists/day; 1 GB | Writes fail. The code catches this, so links just stop being refreshed |
| **Supabase** | Accounts, contacts, ringing, "you're in a call on another device" | 50,000 MAU (monthly active users, meaning people who sign in); 500 MB database; 5 GB egress (data sent out); **200 connections open at once**; 2 M realtime messages/mo; 2 projects | **Paused after 1 week of no activity.** Over quota: warning email plus a grace period |
| **Supabase email** (built-in) | Magic-link sign-in | **2 emails/hour, team members only** | Anyone else simply never gets the email |
| **Resend** | Email invites | **100/day, 3,000/month**; 3 domains | Send fails. The `resend.dev` sender only delivers to the account owner |
| **Sentry** (Developer plan) | Crash reports (only if `VITE_SENTRY_DSN` is set) | 5,000 errors/month; 1 user; 30-day history | Extra errors dropped **(assumption: the pricing page doesn't say)** |
| **Giphy** (beta key) | GIF picker in chat | **100 API calls/hour per key**. The key is shared by *every* user | Picker stops returning GIFs for the rest of the hour |
| **Web Push** | Call notifications when the tab is closed | Browser push services, no published quota | n/a |

Notes. The code calls Giphy only (`src/islands/GifPicker.tsx`); there is no Tenor call.
Krisp noise filtering is on by default (`useNoiseFilter.ts`) with the standard noise model.
LiveKit lists "background noise suppression" as free on Build, and only the separate
"voice isolation" is metered (100 free minutes). **(Assumption:** the standard browser Krisp
filter counts as the free kind; LiveKit's docs don't say this outright.)

## 2. What ONE call uses (read from the code)

**LiveKit, participant-minutes = people × minutes connected.**
- A guest stuck in the waiting room isn't connected, so costs nothing. Neither does the
  preview screen before joining.
- Someone left alone is kicked after **5 minutes** (`SOLO_TIMEOUT_MS`,
  `src/islands/RoomView.tsx:175`), so a forgotten tab costs at most about 5 minutes.
- A room holds at most **10 people** (`ROOM_CAP`, `server/core.mjs:55`). LiveKit enforces
  this itself (`maxParticipants`) and closes the empty room after 60 to 120 seconds.
- Joining "as a companion" on a second device counts as a second participant.

**LiveKit, video data.** Each person downloads everyone else's video. Cameras capture at
720p and send three quality layers (180p, 360p, 720p). Each viewer only pulls the layer its
tile size needs (`src/lib/livekit.ts:67-73`). Default top rates: 720p is 1.7 Mb/s, 360p is
0.45, 180p is 0.16, and a screen share is up to 2.5 Mb/s.
- **(Assumption)** An average of about **1 Mb/s per viewer** in a small camera-on call.
  That's about **7.5 MB per participant-minute**.
- At that rate, the 50 GB runs out at about 6,700 minutes, after the 5,000-minute wall.
- Above about **1.33 Mb/s** average, **data runs out first**. That happens with big
  720p tiles, a screen share, or 5+ people (each viewer receives more feeds).
- Low-bandwidth mode turns the camera off.

**Cloudflare Worker requests per person joining** **(estimate: about 15)**
- `run_worker_first = true` (`wrangler.toml`) sends **every file through the Worker**
  (HTML, JS chunks, CSS, icons, the 6 MB Krisp bundle) so it can add security headers.
  Cloudflare normally serves static files for free. Here each one counts toward the
  100k/day limit, and past it the whole site returns 429.
- Files are served with `max-age=0, must-revalidate`, so repeat visits still check each
  file and count again. That's about 10 to 12 requests per page load **(assumption: no
  build output to count)**.
- On top of that: `/api/knock` ×1, `/api/me` ×1 (landing page, signed-in), `/api/health` ×1.
- Invites, rings (`/api/push`), moderation, host changes: roughly 0 to 3 per call.
- **Waiting room (off by default).** The guest's browser checks `knock-status` every
  **2 s** (`src/routes/RoomRoute.tsx:306`). The host's browser checks `/api/pending` every
  **3 s for the whole call** (`src/islands/WaitingRoomBanner.tsx:41`). That's about
  **600 requests per 30-minute call.**

**KV per join** (`server/core.mjs:450-533`, link-shared rooms only)
- 1 write: `room:<slug>` is stamped with `lastJoinTs` **on every successful join, by every
  participant**. A rejoin after a network drop writes again.
- 1 to 2 reads: one expiry check if the room is empty, plus one read of the existing
  record just before the write.
- The host also costs 1 allowlist read (`allow:<email>`) on knock and again on `/api/me`.
- So a 4-person call is about **4 writes and about 7 reads**.

**Supabase per call**
- Only signed-in people use it. Hosts have to be signed in because of the beta gate;
  guests don't.
- Each open signed-in tab keeps **1 realtime connection** for as long as it's open, even
  when idle on the landing page **(assumption: one connection per tab)**.
- In a call, the tab announces "I'm in room X" to the user's other devices: about 2 to 5
  messages. A ring costs 1 + 1 per receiving tab. Sign-in and the knock check make a
  few auth calls.
- Per call that's about **10 messages**, against a 2 M/month allowance
  **(assumption: presence is counted like broadcast)**.

**Email:** 1 Resend email per "invite by email". Magic-link sign-in goes through
Supabase's sender, not Resend.
**Giphy:** 1 call each time the picker opens (it loads "trending" first), plus 1 per
pause while typing a search (350 ms delay). That's about 2 to 4 calls per GIF sent.

## 3. Three scenarios (per month)

- **A. Friends & family:** 10 calls/week × 3 people × 30 min, about 43 calls/mo.
- **B. Small team:** 20 calls/workday × 4 people × 30 min, about 434 calls/mo (21.7 workdays).
- **C. Growing:** 5× B, about 2,170 calls/mo (100 a workday).

Assumptions: 1 Mb/s per viewer; waiting room off; 1 email invite per 2 calls; 1 GIF picker
session per call; Worker requests counted on the busiest day.

| Limit | A: Friends & family | B: Small team | C: Growing |
|---|---|---|---|
| **LiveKit minutes** (5,000/mo) | 3,900 → **78%** | 52,080 → **1,040%** | 260,400 → **5,200%** |
| **LiveKit data** (50 GB/mo) | 29 GB → 59% | 390 GB → 780% | 1,950 GB → 3,900% |
| LiveKit people at once (100) | 3 → 3% | about 8 to 16 → 16% | about 40 to 75 at peak → **75%** |
| Worker requests (100k/day) | about 150 → <1% | about 1,200 → 1% | about 6,000 → 6% (**66%** with waiting room on) |
| KV writes (1,000/day) | about 6 → 1% | about 80 → 8% | about 400 → **40%** |
| KV reads (100k/day) | <1% | <1% | about 1% |
| Supabase connections (200 at once) | a few → 2% | about 10 to 20 → 10% | 50+ → 25%+ (grows with tabs left open) |
| Supabase messages (2 M/mo) | <1% | <1% | about 1% |
| Supabase MAU (50k) | <1% | <1% | <1% |
| Resend (100/day) | <1/day → 1% | 10/day → 10% | 50/day → **50%** (36% of monthly) |
| Giphy (100/hour) | ~0 | about 8/hour → 8% | about 40/hour avg, peak hours → **100%** |
| Sentry (5k/mo) | depends on bugs, not traffic | same | same |

**Which limit hits first: LiveKit participant-minutes, in all three.**
- **A:** fits with about 20% spare. Four extra calls in a busy month, or a few longer
  ones, and it fails partway through the month.
- **B:** the free minutes are gone on the **2nd workday** of the month.
- **C:** they're gone **before lunch on day one**.

**Break point, in plain words.** The free plan covers about **83 hours of "people on a
call" a month**. For example:
- about **55 calls** of 3 people × 30 min
- about **40 calls** of 4 people × 30 min
- about **8 calls** of 10 people × 1 hour

If calls are video-heavy (big tiles, screen shares), the 50 GB video-data limit can come
slightly *before* that. Next in line after LiveKit, much later:
- **Giphy**, at GIF-happy peak hours (C)
- **KV writes**, at about 250 four-person calls a *day*
- **Worker requests**, at about 6,500 joins a day, or about 150 calls a day with the waiting room on

## 4. Levers, ranked by impact on the limit that binds

LiveKit is the wall, and no code change removes it. The levers stretch the free months
and cut the paid bill.

| # | Lever | Saves | Where |
|---|---|---|---|
| 1 | **Keep test calls off the cloud quota.** Test only against a local `livekit-server`, which CI already does (`e2e-local`). Retire or ignore the cloud test project: it takes from the same 5,000 minutes | Load tests and e2e runs can burn thousands of minutes | `TESTING.md` §1, `CLAUDE.md` banner |
| 2 | **Lower the default video quality.** Cap the top camera layer at 540p (or 360p on phones and in gallery view), and screen shares at 720p/15 fps. **This is the biggest lever on the paid bill**, where video data is most of the cost | Roughly 30 to 50% of video data **(assumption)** | `src/lib/livekit.ts:67-70`, `:106-109` |
| 3 | **Smaller rooms.** Minutes grow with the number of people; video data grows *faster*, because each extra person both sends one more feed and receives everyone else's. `ROOM_CAP` 10 → 6 limits the worst case | Protects against one big call eating the month | `server/core.mjs:55` (env `ROOM_CAP`) |
| 4 | **Shorter solo timeout.** 5 min → 2 min alone | Up to 3 minutes per forgotten call. Small, but free to do | `src/islands/RoomView.tsx:175` |
| 5 | **Stop routing every file through the Worker.** Set `run_worker_first = ["/api/*", "/r/*", "/"]` and move the COOP/COEP/CSP headers onto static files with a `_headers` file. Static files then become free and unlimited, and a busy day can't take the whole site down with 429s | About 80% of Worker requests | `wrangler.toml` `[assets]`, `worker/index.js:94-140` |
| 6 | **Waiting room without polling.** The queue already lives in LiveKit room metadata, which the host's app receives live (`useRoomInfo`). Read pending guests from there instead of asking `/api/pending` every 3 s. Also slow the guest's check from 2 s to 3 to 4 s | About 600 Worker requests per waiting-room call | `WaitingRoomBanner.tsx:41`, `RoomRoute.tsx:306` |
| 7 | **Fewer KV writes.** Only re-stamp `room:<slug>` if the last stamp is more than about a day old, and reuse the record the expiry check already read. That's ≤1 write per room per day instead of 1 per join | About 90% of KV writes | `server/core.mjs:521-532` |
| 8 | ~~**Keep Supabase awake.**~~ **Done**: a Worker Cron Trigger pings Supabase twice a week | Prevents a total outage | `worker/index.js` (`scheduled`), `wrangler.toml` (`[triggers]`) |
| 9 | **Make email actually deliver.** Verify a domain in Resend and change `RESEND_FROM`. Point Supabase's custom SMTP at Resend so magic links reach everyone (they share Resend's 100/day) | Fixes invites and sign-in for non-owners | `wrangler.toml` `RESEND_FROM`, Supabase → Auth → SMTP |
| 10 | **Giphy.** Cache "trending" for the session instead of fetching it on every open, and apply for a production key before growth | About half of Giphy calls | `src/islands/GifPicker.tsx:34-54` |

## 5. When they outgrow free: the next paid tiers

| Service | Next tier | Price | Included | Over that | Needed when |
|---|---|---|---|---|---|
| LiveKit | Ship | **$50/mo** (listed as "starting at") | 150,000 min, 250 GB | $0.0005/min, **$0.12/GB** | More than about 55 calls/mo (A is on the edge) |
| Cloudflare | Workers Paid | $5/mo | 10 M requests, 30 M CPU-ms; KV 1 M writes, 10 M reads | $0.30/M requests; KV $5/M writes | Not before about 6,000 joins/day |
| Supabase | Pro | $25/mo | 100k MAU, 500 connections, 5 M messages, 250 GB egress, **no pausing** | $10 per 1k connections, $2.50 per M messages | For "never pauses", or 200+ signed-in tabs open at once |
| Resend | Pro | $20/mo | 50,000/mo, no daily cap | n/a | More than about 100 invites/day (C, with some headroom) |
| Sentry | Team | $26/mo (billed yearly) | 50k errors | n/a | Only if crash volume grows |
| Giphy | Production key | Custom (fee, by application) | Unlimited | n/a | Peak hours above 100 calls/hour |

**What LiveKit Ship would cost per scenario** (at 1 Mb/s per viewer):

| Scenario | Minutes | Video data | Ship bill |
|---|---|---|---|
| A | 3,900 | 29 GB | **$0** on free, or $50 if you upgrade just to be safe |
| B | 52,080 (inside the 150k) | 390 GB (140 GB over) | $50 + $17 = **about $67/mo** |
| C | 260,400 (110k over, $55) | 1,950 GB (1,700 GB over, $204) | **about $310/mo** |

In C, **video data is two-thirds of the bill**. That's why lever 2 (video quality) is the
one that pays at scale. Halving the average bitrate takes C to about $190.

Total monthly spend at C is about $310 (LiveKit) + $25 (Supabase) + $20 (Resend) +
$5 (Workers) ≈ **$360**. About 85% of that is LiveKit.

## Sources

- LiveKit pricing (Build/Ship limits, overage rates, noise suppression): https://livekit.com/pricing and https://livekit.com/pricing.md
- LiveKit quotas (hard cap, allowance shared across free projects): https://docs.livekit.io/deploy/admin/quotas-and-limits/
- LiveKit noise cancellation (Krisp NC/BVC models): https://docs.livekit.io/transport/media/noise-cancellation/
- Workers limits (100k/day, 10 ms CPU, error 1027): https://developers.cloudflare.com/workers/platform/limits/
- Workers static assets billing (`run_worker_first` → billed, 429 when over): https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Static asset `_headers` and default `max-age=0, must-revalidate`: https://developers.cloudflare.com/workers/static-assets/headers/
- Workers Paid pricing: https://developers.cloudflare.com/workers/platform/pricing/
- KV limits and pricing: https://developers.cloudflare.com/kv/platform/pricing/
- Supabase pricing (Free/Pro, pausing): https://supabase.com/pricing
- Supabase realtime message counting: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages
- Supabase peak connections: https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections
- Supabase default SMTP (2/hour, team only): https://supabase.com/docs/guides/auth/auth-smtp
- Resend pricing: https://resend.com/pricing · test-sender restriction: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- Sentry pricing: https://sentry.io/pricing/
- Giphy beta key (100 calls/hour): https://support.giphy.com/hc/en-us/articles/360035527611-What-is-the-beta-key-What-can-I-do-with-the-beta-key and https://developers.giphy.com/docs/api/
- LiveKit layer bitrates: `node_modules/livekit-client` `VideoPresets` / `ScreenSharePresets`
