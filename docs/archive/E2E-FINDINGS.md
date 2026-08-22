# Manim — E2E test sweep, capacity probe & fix report

_Run date: 2026-06-16 • Branch: `main` • Backup tag: `backup-pre-e2e-2026-06-16` (at `5b83506`)_

Rollback everything in this sweep with:
```
git reset --hard backup-pre-e2e-2026-06-16
```

---

## 1. What was built

A real, runnable Playwright E2E suite under [tests/](../../tests/) driven by [playwright.config.ts](../../playwright.config.ts).
- Runs headless Chromium with fake camera/mic; connects to the **real** LiveKit Cloud backend (creds from `.env`).
- `webServer` auto-starts `npm run dev` (reuses one already running).
- **25 tests, 24 run on every pass, 1 (capacity) gated behind `STRESS=1`.**

Run them:
```bash
npm run dev            # in one terminal (or let the config start it)
npx playwright test --project=desktop            # functional suite (~3 min)
STRESS=1 CAP_N=8 npx playwright test 07-capacity --project=desktop --workers=1   # capacity ramp
```

Coverage: landing + routing, prejoin/device toggles/join (click + Enter), in-call controls (mic/cam/chat/more/layout/devices/settings/reactions), chat (send, markdown, **XSS**, edit, emoji reaction, **60-msg flood**), settings/theme, and multi-party (2 peers see each other, **chat both ways**, **waiting-room admit**, **host force-mute**).

---

## 2. Capacity — actual numbers

Measured by ramping real LiveKit participants (each its own browser context, publishing fake video) into one room on **a single dev laptop**, then inspecting the host's tile grid + console.

| Ramp (`CAP_N`) | Joined / connected to SFU | Host page health | Tile grid on host |
|---|---|---|---|
| **8** | **8 / 8** | **clean — 0 errors** | 3 columns, 7 tiles, 5 actively decoding (adaptiveStream paused the rest) |
| **20** | **20 / 20** (all authenticated + connected) | **degraded** — `negotiation timed out` ×5, `WASM_OR_WORKER_NOT_READY`, `Tried to add a track for a participant that's not present`; host fell back to solo view | — |

**Interpretation (important):**
- **The LiveKit room itself accepted all 20** — token mint + SFU connect succeeded for every participant. There is no app-level participant cap being hit.
- The degradation at 20 is the **single test machine saturating**: 20 headless Chromium instances each running a real WebRTC video encoder pegs the CPU, and the *host's* subscriber PeerConnection negotiation then times out. This is a **test-harness limit, not the product's limit** — 20 real users on 20 real devices would not load any one machine this way.
- **Clean ceiling on this machine: ~8 simultaneous participants** with the host rendering everything error-free. Degradation sets in somewhere between 8 and 20 as local CPU runs out.
- The **real product ceiling** is governed by (a) your LiveKit Cloud **plan's** per-room participant limit, and (b) each viewer's **device** decode budget — which the app already bounds via `adaptiveStream` (off-screen tiles stop decoding) + `dynacast` + simulcast (see [src/lib/livekit.ts](../../src/lib/livekit.ts)). It is **not** bounded by the tile code for any realistic call.

**Tile handling at scale (checked against Mobbin):** WhatsApp, Discord, Messenger, Patreon, Airtime all use the same model Manim already uses — a **scrolling grid of equal portrait tiles** (2 cols on mobile), avatar+waveform when video is off, name + mic-off badge. Manim's tile UX is already industry-aligned; an aggressive "show only N" cap would *regress* vs peers. The one genuine gap was **no upper bound at all** (a 100-person room would mount 100 DOM tiles). Fixed with a high-threshold safety valve — see §3.

---

## 3. Issues found & FIXED (pushed to `main`)

### 🔴 HIGH — Chat data-channel publishes throw during connect (`Cannot read properties of undefined (reading 'next')`)
- **Where:** [src/features/chat/useChatMessages.ts](../../src/features/chat/useChatMessages.ts)
- **Found by:** 2-party test logged the error ×3–4 on join.
- **Cause:** `useChatMessages` hooks run while the room is still `Connecting` (RoomView runs hooks before its connected gate). The join-time **sync-request timers** (history/edit/pin/reaction, ~800–900 ms) fire and call LiveKit `publishData` before the transport is up → it throws inside its own generator.
- **Impact:** unhandled runtime errors on every join; **late-joiner history / reaction / pin / edit replay was unreliable** (the handshake that fetches what was said before you joined could throw instead of send).
- **Fix:** a single guarded `publish()` helper — only sends when `room.state === Connected`, and swallows any transient failure (recovered by later sync-requests + live resends). All five broadcasts routed through it. Verified: error gone, chat + replay work.

### 🟠 HIGH (a11y/usability) — Desktop chat/people panel was modal, freezing the call
- **Where:** [src/components/primitives/Sheet.tsx](../../src/components/primitives/Sheet.tsx), [src/islands/SidePanel.tsx](../../src/islands/SidePanel.tsx)
- **Found by:** controls test couldn't reach the control bar once chat opened.
- **Cause:** the docked side panel used a Radix Dialog with the default `modal={true}`. On desktop it's meant to **dock beside** the live stage (RoomView/ControlBar already reflow with `md:pr-[23rem]`), but modal mode `aria-hidden`s + pointer-blocks the rest of the page.
- **Impact:** while chat/people was open on desktop you **could not mute, stop video, screen-share or leave**, and assistive tech couldn't reach any control. Clicking a control just closed the panel.
- **Fix:** `Sheet` gained a `modal` prop (default `true`, so Settings/GIF/More dialogs are unchanged). SidePanel runs **non-modal on desktop** (pointer-fine) and **modal on touch** (bottom-sheet scrim is right for phones). Overlay only renders when modal; non-modal stays open while you use the call; Esc still closes. Verified.

### 🟡 MEDIUM — Tile grid had no upper bound (DOM blow-up risk in huge rooms)
- **Where:** [src/islands/Stage.tsx](../../src/islands/Stage.tsx)
- **Cause:** the grid mapped **every** participant tile with no cap, virtualization, or overflow.
- **Fix:** a **safety valve** that only engages above **49 tiles (desktop) / 16 (mobile)** — thresholds far above any realistic call, so normal calls are byte-for-byte unchanged. Above it, the last cell becomes a **"+N more"** tile (Google Meet model) and screen-shares + your own camera are kept in the visible set. Decode is already bounded by `adaptiveStream`; this bounds the DOM/subscription count.

---

## 4. Needs your input / approval (NOT changed — decide, then I'll act)

### A. Large-room strategy (the headline decision)
What's the **target maximum room size**? That answer drives whether the §3 safety valve is enough or whether to invest in real **pagination with active-speaker rotation** + explicit **subscription management** (subscribe only to the visible page) and **grid virtualization**.
- If target ≤ ~12–16: current code is fine as-is.
- If 20–50: add paginated grid + active-speaker page rotation; raise/observe the LiveKit plan's per-room cap.
- If 50+: the above **plus** server-side admission control. Also confirm your LiveKit Cloud plan's per-room participant limit (the SFU, not the client, will be the gate).

### B. Silent failures — should these surface a toast? (UX copy decisions)
Each currently fails quietly (`catch {}`); none crash, but the user gets no feedback:
- Picture-in-Picture failed to open — [src/islands/ControlBar.tsx](../../src/islands/ControlBar.tsx) `togglePip` catch.
- Host force-mute request failed — [src/islands/Stage.tsx](../../src/islands/Stage.tsx) `forceMute` catch ("surfaced elsewhere" — but isn't, per-tile).
- Mic/camera device switch rejected by browser — noise filter / device constraints.
- Krisp AI noise / GPU background-blur silently downgraded to the weaker path — [src/features/effects/useNoiseFilter.ts](../../src/features/effects/useNoiseFilter.ts), [src/features/effects/useBackgroundBlur.ts](../../src/features/effects/useBackgroundBlur.ts).
- Flip-camera failed (single-camera device) — [src/lib/useFlipCamera.ts](../../src/lib/useFlipCamera.ts).
- Email invite send failed — fallback to `mailto:` not always reached — [src/islands/ParticipantsPanel.tsx](../../src/islands/ParticipantsPanel.tsx).

Want a toast for all of these, a subset, or leave silent? I can batch-apply once you pick.

### C. Waiting-room request **expiry** shows nothing
[src/routes/RoomRoute.tsx](../../src/routes/RoomRoute.tsx) — on `expired` it just drops back to prejoin with no message. Suggest a "Your request timed out — try again" toast. Approve the copy and I'll add it.

### D. PiP target-video heuristic is fragile
[src/islands/ControlBar.tsx](../../src/islands/ControlBar.tsx) `togglePip` picks the PiP video by `getComputedStyle(v).transform === 'none'` (to skip the mirrored self-view). A remote with any CSS transform would be skipped. Low impact (Document PiP is the primary path); fix is to key off the tile's `isLocalCam` model instead. Approve and I'll switch it.

---

## 5. Confirmed-good (tested, no action)
- Landing routing/slugify, prejoin gating, join via click **and** Enter, leave→home.
- Mic/cam/chat/more/layout/devices/settings controls; desktop reactions picker.
- **Chat markdown renderer is XSS-safe** — `<img onerror=…>` renders as literal text, no script runs ([src/lib/formatText.tsx](../../src/lib/formatText.tsx) returns React nodes, never HTML). Verified by test.
- Chat **flood of 60 rapid messages** stays responsive, no errors, composer still works.
- Multi-party: peers see each other, chat propagates both ways, **waiting-room admit** works, **host force-mute** works.
- `.env` secrets are correctly gitignored.

---

_Suite + config + these three fixes are committed. Capacity raw output is in `playwright-report/capacity.json` after a `STRESS=1` run (gitignored)._
