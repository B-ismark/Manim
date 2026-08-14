# Low-bandwidth UX & performance — findings and plan

**Status:** research / proposal. Nothing here is implemented yet.
**Goal:** a usable call on a 2G-to-weak-3G link (≤150 kbps, 400–1200 ms RTT, 5–30 %
loss, frequent 5–20 s blackouts) — the profile of a Ghanaian mobile data user on a
congested cell, which is the real target, not a lab-throttled desktop.

The app is already well tuned for a *good* network degrading to a *mediocre* one.
It is not built for a network that is bad from the first frame and stays bad. That
is the gap this document is about.

---

## 1. What already works (do not rebuild these)

Worth stating plainly, because most "make it work on slow networks" advice is
already shipped here:

| Mechanism | Where |
|---|---|
| Simulcast + `dynacast` + `adaptiveStream` — subscribers pull only the layer their tile needs, uplink sheds layers without touching capture | `src/lib/livekit.ts` |
| `degradationPreference: 'maintain-resolution'` — sheds fps before resolution | `src/lib/livekit.ts:68` |
| Opus DTX (near-zero bitrate in silence) + RED (loss-resilient audio) | `src/lib/livekit.ts:70-72` |
| VP9 on desktop / VP8 on mobile+E2EE, with a documented rationale | `src/lib/livekit.ts:47-49` |
| Join-time low-bandwidth mode: 360p capture, two simulcast layers, camera off | `src/lib/livekit.ts:54-57`, `PreJoin.tsx:368` |
| In-call "turn off incoming video" — unmounts remote `<VideoTrack>`, so adaptiveStream pauses the flow | `useRoomStore.audioOnly`, `Stage.tsx:1088`, `ControlBar.tsx:474` |
| Join retry with backoff, transient-vs-definitive error classification | `RoomRoute.tsx:144-197` |
| Lazy room chunk + eager warm of the side-panel chunk (explicitly for slow links) | `App.tsx:12`, `RoomView.tsx:321` |
| Ink + reactions on the **lossy** data channel with self-describing packets | `lib/annotate/wire.ts`, `useReactions.ts:77` |
| `manualChunks` splitting livekit/react into long-cache vendor chunks | `vite.config.ts:43` |

The media layer is in good shape. **The gaps are almost all above and around it:**
the app never *measures* the network, never *adapts on its own*, gives the user a
single irreversible join-time switch, and has no story at all for the seconds when
the link is gone.

---

## 2. Findings — concrete gaps

### F1. `lowBandwidth` is a one-way, join-time decision
`roomOptions(lowBandwidth, e2ee)` is memoised on the flag (`CallRoom.tsx:36`) and
feeds `RoomOptions` at construction. A user whose network collapses ten minutes in
cannot enter low-bandwidth mode; the only mid-call lever is `audioOnly`, which is
**receive-side only** — their own 720p uplink keeps trying. On a congested uplink
that is exactly the wrong way round: upload is usually the scarcer direction.

### F2. Nothing in the app knows how bad the network is
No `navigator.connection`, no `Save-Data`, no `navigator.onLine`, no `getStats()`
polling anywhere in `src/`. LiveKit's `ConnectionQuality` score is consumed, but
only decoratively — a warning pill (`CallStatusBar.tsx:110`) and a per-tile badge.
Nothing *acts* on it. There is no signal that could drive an adaptive default, a
prompt, or a diagnosis.

### F3. Low-bandwidth defaults to off, always
`useAppStore.ts:56`. A user on `slow-2g` with `Save-Data: on` gets the same 720p
default as a user on fibre, and only finds the toggle if they read the prejoin
footer row.

### F4. The service worker is push-only — there is no app shell
`public/sw.js` handles `push` and `notificationclick`, nothing else. No precache,
no runtime caching, no offline fallback. Consequences on a slow link:
- Every cold load re-downloads the JS over the bad connection. The vendor chunks
  are hash-immutable so HTTP cache helps *if* it survives, but there is no
  stale-while-revalidate and no guarantee.
- Losing the network mid-session and navigating = white screen, no explanation.
- The `RoomView.tsx:321` side-panel warm is a hand-rolled fix for exactly this
  problem, applied to exactly one chunk. That instinct is right; it should be a
  general mechanism.

### F5. Join is fully serialised over the worst possible RTT
`handleJoin` → `supabase.auth.getSession()` → `POST /api/knock` → *then*
`LiveKitRoom` opens the WSS. At 800 ms RTT that is ~3 sequential round trips before
signalling even starts, plus DNS + TLS to the LiveKit host from cold — and
`index.html` has **no `preconnect` / `dns-prefetch`** for the LiveKit or Supabase
origins.

### F6. The sender's file-transfer progress is a lie
`sendFile` (`useChatMessages.ts:632`) inserts the local card with `progress: 1`
before `localParticipant.sendFile` is awaited. The receiver gets real progress via
`reader.onProgress`; the sender sees "done" instantly. On a 100 kbps uplink a 20 MB
file (allowed — cap is 25 MB, `chat/limits.ts`) takes ~27 minutes while the UI
claims it finished. There is also no resume: a drop mid-transfer restarts from zero,
and the `catch` silently removes the card.

### F7. A file transfer can starve chat
`sendFile` and chat text both ride the **reliable** data channel. A 25 MB transfer
on a thin uplink will head-of-line block ordinary messages behind it for minutes.

### F8. Chat text sent during a reconnect is dropped
`sendText` returns `false` on failure (`useChatMessages.ts:625`) — there is no
outbox, no retry, no "will send when reconnected" state. On a flaky link this is the
single most visible failure to a user, because they *typed* it.

### F9. `audioOnly` pauses but does not unsubscribe
Unmounting the `<VideoTrack>` makes adaptiveStream disable the track, which does
stop the media flow — but the subscription and transceiver stay alive. `setSubscribed(false)`
on remote video publications is the harder floor, and it is the right one for a
deliberate "I am on 2G" mode.

### F10. Nothing verifies any of this
`playwright.config.ts` has no throttled project. `lighthouserc.json` runs
`preset: desktop`, unthrottled, with no resource-size budget. The entire
low-bandwidth story is untested, which is why F1–F9 could accumulate quietly.

### F11. Heavy optional payloads on the critical-ish path
Krisp pulls a WASM model; blur pulls ~160 KB of MediaPipe from `cdn.jsdelivr.net`
(a *third-party* origin — extra DNS + TLS + no coordination with our cache). Blur is
correctly lazy. On a slow link both should be gated on measured bandwidth, not just
on user intent. GIFs from Giphy auto-load for trusted hosts (`limits.ts`
`isAutoLoadImageUrl`) — fine on wifi, expensive on 2G.

---

## 3. Proposals

Ordered by (value on a bad network) ÷ (effort). Everything here is achievable with
the current stack; nothing needs a new vendor.

---

### Tier A — sense the network (unblocks everything else)

#### A1. A `useNetworkProfile()` hook — one source of truth
A small module that fuses three signals into one coarse verdict
(`good | weak | dire | offline`) plus a *direction* (uplink vs downlink bound):

1. **`navigator.connection`** — `effectiveType`, `downlink`, `rtt`, `saveData`.
   Chromium-only (Safari and Firefox do not ship it), so it is a *hint*, never the
   basis. It is the only signal available **before** the call connects, which makes
   it the right input for a prejoin default.
2. **LiveKit `ConnectionQuality`** — already available, already debounced in
   `CallStatusBar.useDebouncedPoor`. Promote that debounce into the shared hook
   instead of leaving it local to a pill.
3. **`RTCPeerConnection.getStats()`**, polled every ~2 s — the only signal that
   tells you *which direction* hurts. Track `availableOutgoingBitrate`,
   `outbound-rtp.qualityLimitationReason` (`bandwidth` vs `cpu`),
   `remote-inbound-rtp.fractionLost` / `jitter`, `candidate-pair.currentRoundTripTime`.

Keep it out of React state at the sample level — same discipline as
`AnnotationEngine`. Sample into a ring buffer, publish only the coarse verdict on
change (hysteresis: ~5 s to degrade, ~20 s to recover, so the UI cannot flap).

**This one hook is the dependency for A2, B1, B2, C3, D1 and E2.** Build it first.

#### A2. Feed it into `report.ts` breadcrumbs
`RoomView.tsx:238` already breadcrumbs connection-state transitions. Add a
network-profile transition breadcrumb and the last N stats samples. Cheap, and it
turns "the call was bad" bug reports into something diagnosable.

---

### Tier B — give the user real, reversible levers

#### B1. Replace the boolean with a **Data saver** mode that works mid-call
Three named tiers, changeable at any time, from prejoin *and* the More sheet:

| Tier | Send | Receive | ~Total |
|---|---|---|---|
| **Full** (default on good) | up to 720p, 3 layers | best fitting layer | 1–2 Mbps |
| **Saver** | 360p, 2 layers, 15 fps cap | 180p ceiling via `setVideoQuality(Low)` | ~250 kbps |
| **Audio only** | no video published | `setSubscribed(false)` on all remote video (F9) | ~30 kbps |

Mid-call transitions do **not** need a reconnect:
- Receive side: `setVideoQuality()` / `setSubscribed()` per remote publication.
  Instant, no renegotiation.
- Send side: `LocalVideoTrack.restartTrack({ resolution })` +
  `setPublishingLayers()`. This *does* re-acquire the camera — the exact flicker
  the removed `useAdaptiveQuality` caused (`RoomView.tsx:189-194`). Which is why:

**The receive side changes automatically; the send side only changes on an explicit
user tap.** That preserves the hard-won "no capture restart on a quality flap" rule
while still fixing F1 — the user gets a deliberate lever, the app never yanks their
camera on its own.

Setting persists per device (`localStorage`, same pattern as `gridSize`), so a user
on a permanently bad link is not re-choosing every call.

#### B2. Adaptive defaults, honestly disclosed
On prejoin, when `saveData === true` or `effectiveType` is `2g`/`slow-2g`, default
to **Saver** — with a visible, one-tap-reversible note: *"Slow connection detected —
starting in data saver. Use full quality →"*. Never silently. A silent downgrade is
how users conclude the app is low quality.

#### B3. Tell them *whose* network is the problem
The current pill says "Weak connection" without a subject. With A1's direction
signal, say the useful thing: *"Your upload is struggling — others may see you
frozen"* vs *"Ama's connection is weak"* vs *"You're on a slow network — switch to
data saver?"* with the action inline. This is the highest-UX-value, lowest-effort
item in the whole document. Route it through `TopStack` — no new `fixed` element.

#### B4. Audio-first join
Publish the mic immediately; hold camera publication until the connection has been
`Connected` and not `Poor` for ~3 s. On a bad link this converts "40 s of nothing"
into "talking in 6 s, video arrives when it can". Fits the existing prejoin model
and needs no new UI.

---

### Tier C — cut the bytes needed to *reach* a call

#### C1. Turn the service worker into a real app shell (F4)
Precache the HTML shell, the react + livekit vendor chunks and the CSS on install;
serve them cache-first with a background revalidate. Effects:
- Second and subsequent loads become near-instant on any link.
- A mid-call chunk fetch (side panel, blur) cannot hang forever — it is local.
- Generalises the `RoomView.tsx:321` warm hack into a mechanism.

Hand-write it or adopt `vite-plugin-pwa` (Workbox). Given the existing `sw.js` is
deliberately tiny and hand-written, and given the CSP and COOP/COEP constraints in
`worker/index.js`, **hand-written with an explicit precache manifest is likely the
better fit here** — Workbox would pull in build machinery for a ~60-line problem.
Must keep the existing `push` / `notificationclick` handlers intact.

#### C2. Offline shell + `navigator.onLine` (F4)
A `navigator.onLine` + `offline`/`online` listener, surfaced as a `TopStack` banner,
and an SW offline fallback page. Today, flight mode on `/r/foo` is a white screen.
Also: hold the join button and say *"You're offline"* rather than letting `knock`
burn its three retries against a dead radio.

#### C3. `preconnect` the media and auth origins (F5)
`<link rel="preconnect">` for the LiveKit host and the Supabase host in
`index.html`. `VITE_LIVEKIT_URL` is a build-time constant, so this can be injected
by a tiny Vite transform. On an 800 ms-RTT link this removes DNS + TCP + TLS (~2–3
RTT, i.e. **1.5–2.5 s**) from the critical path. Cheapest win in this document.

#### C4. Performance budgets that actually bite (F10)
Add `assertions` for `resource-summary:script:size` to `lighthouserc.json`, and a
second Lighthouse run with mobile + `slow4G` throttling. A budget that never fails
is not a budget.

---

### Tier D — survive the outage, don't just degrade through it

#### D1. A chat outbox (F8)
Queue failed sends in the store with a `pending` / `failed` state, flush on
`ConnectionState.Connected`, show the standard clock-then-tick affordance
(WhatsApp's model — the reference set is already in `Architecture-Plan.md §5.1`).
Bounded queue, drop with a visible error rather than growing forever.

#### D2. Honest, resumable file transfer (F6, F7)
1. **Fix the lie first** — drive the sender's card from real progress. LiveKit's
   `sendFile` wraps `streamBytes`; using the writer directly gives per-chunk
   progress and a cancel button. Small change, removes a genuine trust bug.
2. **Scale the cap to the link.** 25 MB is fine on wifi and absurd on 2G. Warn above
   ~2 MB when the profile is `weak`/`dire`, with the real estimate: *"About 8 minutes
   on your connection."*
3. **Yield to chat** (F7) — one transfer at a time, chunked with pauses, so text
   never queues behind a file.
4. **Resume** — chunk with an explicit index and re-request missing ranges over the
   lossy channel. Genuinely useful, but non-trivial; do it only after 1–3 land.

#### D3. Widen the reconnect window
LiveKit auto-reconnects; the UI says "Reconnecting…" with no timer, no elapsed
count, and no manual retry (`ConnectionBanner.tsx`). On a link that drops for 30 s
this is the difference between waiting and giving up. Add elapsed time, a "Retry
now" button, and — after a failed reconnect — a rejoin that reuses the existing
`toast` + `autojoin` path from `leaveWithUndo`.

---

### Tier E — media-layer options, with an honest 2026 reality check

**Worth doing now:**
- **Verify Opus in-band FEC is on.** `red: true` gives RED-style duplication;
  in-band FEC (`useinbandfec=1`) is a *separate* mechanism and is the cheaper win
  under moderate loss. Check what LiveKit actually negotiates in the SDP before
  assuming.
- **Cap audio bitrate in Saver/Audio-only.** Opus at 16–24 kbps mono is entirely
  intelligible for speech; the default is considerably higher.
- **Temporal-layer ceiling in Saver.** VP8 in WebRTC supports temporal scalability,
  so the SFU can drop frame rate without a keyframe request. Cheaper and smoother
  than dropping resolution.

**Not yet — track, don't build:**
- **AV1.** Real-time *encode* remains limited to recent high-end hardware and is
  3–5× the CPU of VP9 on a software path; broad cross-browser SVC support is
  realistically 2028+. ~90 % of WebRTC sessions in 2026 are still VP8. Revisit when
  hardware encode is common on mid-range Android — that is exactly the device class
  this project cares about, so it *will* matter, just not yet.
- **Opus DRED** (deep redundancy, ~1/50 the bitrate for ≥1 s of redundancy, far
  better than LBRR under burst loss). Shipped in libopus 1.5, but the format is
  still an IETF draft and browsers do not expose it. Exactly the right technology
  for this problem — check back in a year.
- **Neural codecs (Lyra/Satin-class).** Would need custom WASM + insertable
  streams. The E2EE path (`livekit-client/e2ee-worker`) proves the plumbing is
  familiar, but this is a research project, not a feature.
- **Media over QUIC / WebTransport.** Too early for interactive conferencing, and
  LiveKit does not use it for media.

---

### Tier F — novel, small-scale pathways specific to Manim

Things worth building *because* this app is small and owns its UI. Ranked by how
much they'd differentiate.

#### F-1. "Slideshow video" — a still frame every few seconds (~2–5 kbps) ⭐
**The highest-value novel idea here.** Below the bitrate where WebRTC video is
viable, the choice today is video-or-avatar. A third option: capture one frame every
3–5 s, downscale to ~160×120, encode WebP at low quality (~4–8 KB), and broadcast it
over the **existing lossy data channel**, rendering it in the tile where video would
be.

At ~8 KB / 4 s that is ~16 kbps — an order of magnitude under the ~150 kbps floor
for watchable video, and it restores the thing avatars destroy: *seeing that the
other person is present, engaged, and reacting*.

Why it fits this codebase specifically:
- The lossy data-channel + self-describing-packet discipline already exists and is
  documented (`lib/annotate/wire.ts`). A dropped frame costs one stale tile for 4 s.
  Same trade the ink fade already makes.
- `canvas.drawImage(video)` + `toBlob('image/webp')`, or WebCodecs where available.
  No new dependency.
- Frames must stay out of React state (blob URL swapped on a ref) — the exact rule
  `AnnotationEngine.ts` documents.
- Sender-attributed by the SFU, like ink — no spoofable payload field.
- Interacts correctly with E2EE: data channel payloads are covered by the room's
  E2EE, unlike a naive out-of-band image upload.

Ship it as the visual half of the **Audio only** tier: audio + slideshow, with a
subtle "low-data video" marker on the tile so nobody thinks their connection froze.

#### F-2. A shared "room bandwidth verdict"
Broadcast each participant's coarse network verdict over the lossy channel (one byte,
every ~10 s). Enables things per-subscriber adaptation cannot:
- *"3 of 5 people are on slow connections"* → offer the host a one-tap **room-wide
  data saver**, which caps everyone's publish and is dramatically more effective
  than five people each discovering the toggle.
- Suppress the "your connection is weak" nag when *everyone* is weak — it is a
  venue problem, not a you problem, and saying so is better UX.
- Auto-suggest audio-only for the *presenter* when the room can't keep up with a
  screen share (`useScreenShare.ts:19` already notes `lowBandwidth` never touches
  the share path — this closes that gap).

#### F-3. Store-and-forward voice ("walkie-talkie floor")
When even Opus over RTP cannot hold — sustained >30 % loss — real-time is lost, but
communication need not be. Record 3–5 s segments with `MediaRecorder`
(`audio/webm;codecs=opus`, ~12 kbps), send over the **reliable** channel, play
back in order. Latency becomes seconds instead of milliseconds, but speech arrives
intact. Presented as *"Connection too weak for live audio — switched to voice
messages"*, with automatic return to real-time when the link recovers. A last resort
tier below audio-only, and a genuinely differentiating one for the target market.

#### F-4. Bandwidth-aware feature gating
One predicate (`profile.tier`) gating the expensive optional payloads:
Krisp WASM, MediaPipe blur, Giphy auto-load, GIF picker. On `dire`, do not download
a 160 KB model to blur a background nobody can see. Small, and it composes with
whatever else lands.

---

## 4. Suggested sequencing

| Phase | Items | Why here |
|---|---|---|
| **0 — measure** | A1, A2, C4, a throttled Playwright project | Nothing else can be evaluated without these. Prove the current baseline is as bad as claimed. |
| **1 — cheap wins** | C3 (preconnect), B3 (subject-ful warnings), D1 (chat outbox), D2.1 (honest file progress), C2 (offline banner) | Days of work, immediately felt, low risk. |
| **2 — the real lever** | B1 (Data saver tiers), B2 (adaptive default), F9 (`setSubscribed`), B4 (audio-first join) | The core fix for F1. Depends on A1. |
| **3 — resilience** | C1 (app shell SW), D3 (reconnect UX), D2.2–3 | Structural; needs care around CSP + COOP/COEP. |
| **4 — differentiate** | F-1 (slideshow video), F-2 (room verdict), F-4 (feature gating) | Only worth it once 0–3 make the ordinary path solid. |
| **later** | F-3 (store-and-forward voice), D2.4 (resumable transfer), E (AV1, DRED) | Genuinely novel or genuinely blocked on the ecosystem. |

---

## 5. How to test it (this must come first, not last)

The freeze in `CLAUDE.md` means a **local `livekit-server --dev`** — which the
playbook explicitly permits, and which cannot touch cloud minutes.

1. **A throttled Playwright project.** CDP `Network.emulateNetworkConditions` for the
   signalling/HTTP path, plus Linux `tc netem` on the loopback for the media path
   (CDP throttling does not touch established WebRTC media — the same limitation
   `RoomView.tsx:167-169` already documents for the fault-simulation seam).
2. **Named profiles** matching reality, not `Slow 3G` presets: `2g-congested`
   (100 kbps / 900 ms / 12 % loss), `3g-rural` (400 kbps / 400 ms / 5 %),
   `flaky` (good, with 15 s blackouts every 60 s).
3. **Assert outcomes, not implementation:** audio stays intelligible; the join
   completes within N s; chat sent during a blackout arrives after it; the file card
   never claims a progress it does not have; no white screen at any point.
4. **A bitrate ceiling test** — assert Saver actually stays under its budget via
   `getStats()`. Otherwise the tiers drift into fiction.

---

## 6. Open questions for the owner

1. **Target device floor?** Slideshow video (F-1) and store-and-forward voice (F-3)
   are aimed at a genuinely constrained user. If the real audience is on decent
   4G, Tiers A–D are the whole job and F is over-engineering.
2. **Is auto-degrade acceptable at all on the send side?** The plan above says no
   (respecting the removed `useAdaptiveQuality`). If a *smooth* automatic downgrade
   is wanted, `setPublishingLayers()` without a capture restart is the path worth
   prototyping — it avoids the flicker that got the old approach reverted.
3. **Does the 25 MB file cap earn its keep?** On the target network it may be
   actively harmful. A link-aware cap is easy; a smaller flat cap is easier.
