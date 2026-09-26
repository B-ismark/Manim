# Analytics proposal — Manim

**Status:** decided **yes** (Sept 2026) and built as Option A — `server/usage.mjs`,
`src/lib/usage.ts`, `/api/count`. How to read the numbers: [usage-counts.md](usage-counts.md).
The owner skipped the counsel review for now (a small private beta).

## The problem

Today we can't answer simple questions like: *of the people who open an invite link, how many actually get into the call? Where do the rest give up?* Without that, keep-or-cut calls on features, and on cost levers such as video quality or room size, are guesses.

We don't need to know **who** anyone is to answer these. We only need **counts**.

## Recommendation: a handful of anonymous counters, kept by our own server

Manim already runs on a Cloudflare Worker (our small server program: it hands out call passes, runs the waiting room and serves the site). The proposal is to have it add 1 to a counter when certain things happen, and store the counts in **Cloudflare Workers Analytics Engine**. That's a Cloudflare database built for exactly this, and it's in the account we already have.

What it is **not**:
- **No cookies.** Nothing is stored in the browser, so still no consent banner.
- **No third party.** Cloudflare is already our host and is already on the Privacy page's services list. No new company gets our data.
- **No per-person ids.** No account id, device id, name, email or call name is recorded. We couldn't tell two people apart, or tell whether the same person came back, even if we wanted to.
- **No IP addresses stored.** The Worker simply doesn't write them. (Cloudflare sees IPs to deliver any web page. That's already true today and doesn't change.)
- **No exact numbers that could identify someone.** Durations are stored as ranges ("5–15 min"), and errors as a short code ("link_expired"), never the raw message.

### Cost: free at our size

Analytics Engine's free plan includes **100,000 data points written per day** and **10,000 read queries per day**, and keeps data for **three months**. Cloudflare currently doesn't bill for Analytics Engine at all. When billing starts, the paid plan includes 10 million writes a month. [1][2]

One call produces roughly 5–8 events, so we'd hit the limit at around 12,000+ calls a day. That's far beyond the LiveKit ceiling we'd hit first (about 13 three-person half-hour calls a week on its free plan).

**Why not KV** (the simple key-value store Manim already uses for rooms): its free plan allows only **1,000 writes per day** [3]. Every counter bump is a write, so a busy afternoon would use up the allowance that the waiting room and room setup need to work. It's also bad at many people adding to the same counter at the same moment. KV stays for room data, and Analytics Engine gets the counts.

## Exactly what we'd count

Every event carries only its name, plus at most: **phone or desktop** (touch vs mouse), and a **short code or range** where shown. Nothing else.

| # | Event | Extra detail | The question it answers |
|---|---|---|---|
| 1 | **Landing viewed** | phone / desktop | How many people arrive at all? The top of the funnel. |
| 2 | **New meeting started** | — | How many visitors start a call rather than join one? |
| 3 | **Prejoin reached** | via New meeting / via invite link | How many make it to the "get ready" screen, and from where? |
| 4 | **Joined** | camera on/off at join, low-bandwidth on/off | How many get from prejoin into a call? **The biggest drop-off question.** Do people join with the camera off? |
| 5 | **Left** | duration range: <1 · 1–5 · 5–15 · 15–30 · 30–60 · 60+ min | How long are real calls? Are there many <1 min calls (someone joined, found nobody, gave up)? This also feeds the cost model. |
| 6 | **Knock rejected** | reason: `host_denied` · `timed_out` · `locked` · `room_full` · `link_expired` · `need_link` · `need_key` · `not_in_beta` | Why do people fail to get in? E.g. lots of `link_expired` means links expire too fast. |
| 7 | **Device permission denied** | camera / mic / both, phone / desktop | How often does the browser's camera/mic prompt stop people? Tells us whether prejoin's explanation is working. |
| 8 | **Join error** | class: `permission` · `network` · `server` · `seat_taken` · `other` | When Join fails, is it us, their network, or their browser? |

Together, 1 → 3 → 4 gives the **join funnel**, e.g. "100 opened a link → 80 reached prejoin → 55 got in". Events 6–8 explain the gaps between those steps.

Several of these (6, and parts of 4 and 8) the Worker can count **by itself**, because it already decides them. The rest need a tiny one-line "ping" from the browser to our own Worker. There's no tracking script and no outside address.

### Rules we'd hold ourselves to
1. Never record a call name, person, account, device or IP, and never raw error text.
2. Only add an event when it answers a named question like the ones above.
3. Only look at totals. Don't read single rows.
4. Keep data for three months (the default) and no longer.

## Alternatives, briefly

| | **A. Our own counters** (recommended) | **B. Cloudflare Web Analytics** | **C. Plausible / Umami** |
|---|---|---|---|
| Cost | Free | Free | Plausible from ~$9/month [5]. Umami Cloud free up to 100k events/month, or self-hosted on a server we'd run [6] |
| Cookies / tracking | None | None: cookieless, no fingerprinting [4] | None (both are cookieless) |
| New third party | No | No (Cloudflare) | **Yes**: a new service on the Privacy page |
| Counts the join funnel, errors, call length | **Yes** | **No**: page views, referrers and speed only. No custom events [4] | Yes (custom events) |
| Extra script in the app | No | Yes (a Cloudflare beacon, and the security policy needs changing) | Yes (and the security policy needs changing) |
| Privacy wrinkle | — | Page paths like `/r/team-standup` would show **call names** in the dashboard | Same page-path issue unless configured carefully |
| Nice dashboard out of the box | No (see effort) | Yes | Yes |

**Why not B or C:** B is free and private but can't see the parts we care about. It doesn't know if anyone *joined*. C can, but adds a company, a script and (for Plausible) a bill, just to get a prettier chart.

## What the Privacy page would need to say

Add one short section, and add "anonymous usage counts" to Cloudflare's purpose in the services list:

> **Usage counts.** To see where people get stuck, Manim counts a few anonymous events, such as "a call was joined" and roughly how long it lasted, in ranges. These counts don't use cookies and don't include your name, account, device, IP address or call names, so they can't be linked to you. They're stored by Cloudflare for three months.

The existing line "We don't use tracking or advertising cookies" stays true. The counsel review already on the backlog should confirm the legal basis for this too (likely "legitimate interest", given nothing identifies anyone).

## The decision needed

> **Do you want anonymous usage counts at all?**
> **Yes** → we build Option A, exactly as listed above (8 events, nothing more), and update the Privacy page.
> **No / not yet** → nothing changes. This stays on the backlog.

## Effort, if yes

| Piece | Estimate |
|---|---|
| Worker: an Analytics Engine connection plus one small "count this" endpoint | ~2 hours |
| The 8 events wired into landing, prejoin, join, leave and the waiting room | ~3–4 hours |
| Privacy page text | ~30 min (plus the counsel review) |
| Viewing the numbers: a saved set of queries you can run, giving a funnel table | ~1–2 hours |
| *Optional later:* a small private dashboard page with the funnel as a chart | ~0.5–1 day |

**About one working day** for the counts and a readable funnel table. Add half a day if you want a dashboard. No new accounts, no new bills.

---

**Sources** (checked September 2026)
1. Cloudflare, *Workers Analytics Engine: Pricing*: https://developers.cloudflare.com/analytics/analytics-engine/pricing/
2. Cloudflare, *Workers Analytics Engine: Limits* (three-month retention): https://developers.cloudflare.com/analytics/analytics-engine/limits/
3. Cloudflare, *Workers KV: Pricing* (free plan 1,000 writes/day): https://developers.cloudflare.com/kv/platform/pricing/
4. Cloudflare Blog, *Free, privacy-first analytics for a better web*: https://blog.cloudflare.com/free-privacy-first-analytics-for-a-better-web/ and FAQ https://developers.cloudflare.com/web-analytics/faq/
5. Plausible pricing overview, 2026: https://seline.com/blog/plausible-analytics-pricing
6. Umami pricing: https://umami.is/pricing
