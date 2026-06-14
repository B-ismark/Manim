# Video Conferencing Platform — Architecture Plan (v2)

A free, secure, lightweight, component-driven platform for calls up to ~20 now, designed to scale toward 100.

**Design principles:** Modular & responsive · Progressive disclosure · Simple · Island-styled · Lightweight · Highly secure · Free · **Accessible** · **Zero orphaned UI**

**Target profile:** start ≤20 participants · architecture scales to 100 · balanced E2EE/features · $0 baseline · fully managed (no infra to run)

**Version:** 2.0 — Draft (supersedes v1)

---

## 1. What changed from v1 (and why)

v1 assumed a self-hosted SFU on an Oracle Always Free VM, engineered for 20–100, with a Svelte frontend. After clarifying requirements, the following decisions changed:

| Topic | v1 | v2 | Reason |
|---|---|---|---|
| **Media host** | Self-host LiveKit on Oracle VM | **LiveKit Cloud free tier** | "Managed cloud, no infra to run." A VM you patch/secure is the opposite of managed. Cloud = zero ops, same SDK, upgrade path to 100. |
| **Scale target** | 20–100 from day one | **≤20 now, 100-ready architecture** | Start small. SFU (LiveKit) makes 100 possible later with no rework — just a plan upgrade. |
| **Frontend** | Svelte | **React + `@livekit/components-react`** | LiveKit's richest, battle-tested SDK is React. Less hand-rolled WebRTC glue = fewer bugs = easier to manage solo. Lightweight goal preserved via tree-shaking + lazy loading. |
| **File sharing** | Not specified | **P2P WebRTC data channel** | No storage at rest = most secure, zero cost, no free-tier dependency. Aligns with "no media stored." |
| **Backend role** | "Tiny JWT minter" | **Session orchestrator** (still serverless) | Call-merge + multi-device handoff + waiting-room admit need real orchestration logic. Still fits in serverless functions. |
| **Theming** | Generic tokens | **Slack-model theming** | Named preset tiles up front, custom-token tab behind disclosure, vision-assistive themes baked in. Simple + powerful + accessible. |

What v1 got right and stays: SFU is mandatory (mesh dies at 5–6 peers); LiveKit over Jitsi (engine-first, we own the UI); island UI; progressive-disclosure tiers; three-plane security; per-room E2EE toggle.

---

## 2. Principles → Architecture

| Principle | How the architecture delivers it |
|---|---|
| **Modular & responsive** | One React component library. Every surface (tiles, control bar, chat, settings) is an independent, token-themed module with breakpoint-driven layout. |
| **Progressive disclosure** | Tier 0 (video + 4 controls) by default. Host tools, layout, device settings, diagnostics revealed on demand. |
| **Simple** | One primary action per context. Max two menu levels. Plain-language labels. |
| **Island-styled** | Floating, rounded, shadowed panels with margin over a neutral stage (ClickUp + Runway model). Nothing welded to the edge. |
| **Lightweight & efficient** | Tree-shaken React, lazy-loaded non-critical modules, simulcast + adaptive bitrate, low-bandwidth/audio-only mode, watch-only toggle. |
| **Highly secure** | HTTPS/WSS everywhere, short-lived JWTs, waiting room + lock, optional E2EE, no media at rest, managed provider (no self-run attack surface). |
| **Free** | LiveKit Cloud free tier + Cloudflare/Vercel free + Supabase free. $0 baseline. |
| **Accessible** | Building block, not a finishing pass. Radix primitives for all overlays (focus/ARIA/keyboard for free), global focus ring, `prefers-reduced-motion`, vision-assistive themes, contrast-safe `overlay` token for on-video chrome, meaning never by color alone. Enforced at the token/primitive layer — see [STYLE.md](STYLE.md) §6. |
| **Zero orphaned UI** | Single component library + design tokens. If an element can't be built from tokens + existing components, it doesn't ship. (See §6.) |

---

## 3. Technology Stack (all free, all managed)

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | React + Vite + `@livekit/components-react` | Richest LiveKit SDK; prebuilt tiles/controls/PiP hooks we style into islands. |
| **Frontend host** | Cloudflare Pages (or Vercel) free | Git push = deploy. Auto TLS. Zero ops. |
| **Media SFU** | LiveKit Cloud free tier | Fully managed WebRTC. Simulcast, adaptive streaming, E2EE support, Krisp noise cancellation built in. |
| **Signaling** | LiveKit (provided) | No separate signaling server to build/secure. |
| **Auth** | Supabase Auth free (or Clerk free) | Managed accounts/guests/SSO. No auth code to secure. |
| **Token + orchestrator API** | Cloudflare Workers or Supabase Edge Functions free | Serverless. Mints JWTs, runs merge/handoff/admit. No always-on server. |
| **File transfer** | WebRTC data channel | No storage, no cost, most secure. |
| **State / DB (minimal)** | Supabase Postgres free | Users, meeting metadata, room codes. No media. |

**TURN/STUN, coturn, Caddy, Oracle VM — all removed.** LiveKit Cloud provides TURN; the host provides TLS.

> **Why LiveKit over Jitsi:** Jitsi ships a complete UI we'd fight to restyle into islands. LiveKit is engine-first — SDKs only, full UI control. Exactly what a custom design system needs.

---

## 4. System Architecture

### 4.1 Runtime flow
1. Browser loads React app over HTTPS (Cloudflare/Vercel).
2. User authenticates via Supabase (or joins as guest with a room code).
3. App calls the Token/Orchestrator API → returns short-lived JWT scoped to room + role (`userId#deviceId` identity).
4. Browser opens WSS to LiveKit Cloud using the JWT.
5. LiveKit negotiates WebRTC; media flows peer→SFU→peers (DTLS-SRTP encrypted in transit always).
6. On leave, JWT expires. No media persisted (no recording in v2).

### 4.2 Trust boundaries
- **Public zone:** static React assets + host CDN.
- **Authenticated zone:** Token/Orchestrator API + Supabase Auth — only components that know identity.
- **Media zone:** LiveKit Cloud — handles streams, holds no long-term user data.
- **Client-only zone:** when E2EE is on, decrypted media exists only in browsers; the SFU forwards ciphertext it cannot read.

### 4.3 The orchestrator (the one custom backend)
Serverless functions, no always-on server. Responsibilities:
- Mint room JWTs with `userId#deviceId` identity + role.
- **Multi-device handoff:** issue token to new device, signal old device to leave; media continues seamlessly.
- **Call merge:** relocate room-B participants into room-A (re-mint tokens, clients reconnect).
- **Waiting room:** hold guests; push admit/deny decisions to host; admit moves guest into room.
- **Room lock:** hard close — no entry after lock.
- Enforce host role for privileged actions.

---

## 5. UI Architecture

### 5.1 Island model (ClickUp + Runway)
Neutral stage. Functional surfaces float as rounded, shadowed islands with deliberate margin — nothing edge-welded.

**Reference set:**
- Layout / tiles: [ClickUp](https://mobbin.com/screens/26743fe2-0014-4310-9123-19d4c8db9bcc), [ClickUp + side panel](https://mobbin.com/screens/271ea1c5-6c26-4a93-ae37-fe431051b35c) — rounded card tiles on neutral grey, centered control pill, dark-border active speaker.
- Floating elements: [Runway](https://mobbin.com/screens/395f2c42-ce3e-4221-897d-c7293f2f8de8), [Craft canvas](https://mobbin.com/screens/ba874800-2f7d-4f4b-bba3-534a7b4f9aca) — detached toolbars/panels, shadow depth + margin.
- Minimal control bar: [Cal.com](https://mobbin.com/screens/0216bd7c-e45b-4bed-b070-01d3e98e598f).
- Docked side panels (desktop): [Teams chat](https://mobbin.com/screens/e80b53fe-2d62-4f70-aa58-29972328d9d7).
- Inline file in chat: [Skype web](https://mobbin.com/screens/900f9df1-5e08-40ae-beda-471ed68f344a).
- In-call toasts (join/merge prompts): [Stitch](https://mobbin.com/screens/c2f6635a-0a35-46ac-a73b-e802ceeb6d8d).

### 5.2 Island inventory
| Island | Contents & disclosure |
|---|---|
| **Stage / tiles** | Responsive grid of rounded video cards. Active-speaker emphasis. Collapses to strip in screen-share. Pin/spotlight. |
| **Control bar** | Floating pill (desktop center / mobile thumb-zone): mic, camera, share, leave. Everything else behind "More". |
| **Side panel** | Slide-in island: chat / participants. Docks + reflows stage on desktop; full-height sheet on mobile. Lazy-loaded. |
| **Host island** | Mute-all, lock, waiting-room admit, E2EE toggle. Rendered only if JWT carries host role. |
| **Pre-join island** | Device check, name entry, low-bandwidth option. |
| **Waiting-room island** | Guest: "waiting to be admitted." Host: "X wants to join → Admit/Deny." |
| **Settings island** | Device switcher, background blur + slider, theme, captions (deferred), diagnostics. |
| **Notification island** | Floating toasts: join/leave, incoming-call banner, merge prompt, connection warnings. |

### 5.3 Progressive disclosure tiers
- **Tier 0 (always):** your video, others' video, mic, camera, leave.
- **Tier 1 (one tap):** share screen, chat, participants, layout switch, reactions, raise hand.
- **Tier 2 (behind More/Settings):** device selection, background blur, theme, E2EE, diagnostics, host controls.

*A first-time participant joins and talks having seen only Tier 0.*

### 5.4 Responsive behaviour — same components, breakpoint only
- **Desktop:** grid stage, side panel docks right (reflows stage), control pill centered, hover-reveal Tier-1, keyboard shortcuts.
- **Tablet:** fewer grid columns, side panel overlays.
- **Mobile:** single active tile + swipeable strip, control bar in thumb zone, panels become full-height sheets, front/rear camera switch.

Mobile and desktop run the **same component tree** — only layout props differ. No separate mobile screens.

---

## 6. Component System — the anti-orphan guarantee

Hard rule: **no orphaned UI elements.** Enforced structurally:

1. **Single component library.** Every atom (Button, Tile, Panel, Sheet, Toggle, Slider, Avatar, Badge) defined once. Desktop + mobile import the same components.
2. **Design tokens drive everything.** Color, spacing, radius, shadow, typography as CSS custom properties. Theme change = token swap, zero component edits.
3. **Responsive primitives, not duplicate screens.** One `<ControlBar>` renders centered pill (desktop) or thumb bar (mobile) by breakpoint. One implementation.
4. **Anti-orphan gate.** If an element can't be expressed from the token system + component library, it does not ship. New visual = new token or new documented component, never a one-off style.
5. **Composition over variants.** Islands compose atoms; features compose islands. Tweaks happen at the token or atom level and propagate everywhere.

This makes later tweaks cheap and keeps mobile/desktop visually consistent.

---

## 7. Theming (Slack model)

**Reference:** [Slack themes](https://mobbin.com/screens/0c891c7f-fed0-475d-be60-89c880f30c29), [preset previews](https://mobbin.com/screens/178c037e-1568-4bc0-866d-644bf4571ed2), [call backgrounds](https://mobbin.com/screens/6f734e3e-1315-46d0-b21c-4e5c9a280c0a).

Structure:
- **Mode toggle:** Light / Dark / System (one decision, top of panel).
- **Named preset tiles:** each a single-click swatch shown as a *mini live preview of the real UI*. Casual users never touch a hex code. Ship ~6–8 presets at launch.
- **Custom theme tab:** hidden behind disclosure. Full per-token control for power users.
- **Vision-assistive themes:** Tritanopia, Protanopia/Deuteranopia presets — accessibility by default.
- **Call backgrounds:** separate from chrome theme (Featured/Colors/Landscapes), maps to background-blur/replace feature.

All presets are just token sets → fits §6 perfectly.

---

## 8. Feature Set (complete inventory)

### 8.1 Differentiators (the reason this exists)
- **Lightweight + low-latency** — managed SFU, simulcast, adaptive bitrate, lean React.
- **Call merging** — active call + incoming call → merge into one room. UI model: [TextNow merge](https://mobbin.com/screens/89220001-0d3e-41f2-91b8-2e81b12dc675), incoming banner [WhatsApp](https://mobbin.com/screens/015c34fb-3854-43a9-b803-c9171ce6ac9b).
- **Multi-device handoff** — transfer a call from one device to another (`userId#deviceId` identity). Simultaneous mode is a future extension the identity model already supports.
- **Picture-in-Picture** — native browser PiP for tiles + when tab backgrounded.

### 8.2 Core call (table stakes — all in scope)
- Video tiles + active-speaker emphasis; **pin / spotlight**.
- **Layout switcher** (grid ↔ speaker ↔ spotlight).
- Control bar: mic, camera, screen share, leave; per-tile speaking/muted indicators.
- Self-view hide / mirror toggle.
- **Connection-quality indicator** (signal bars).
- **Device switcher mid-call** (camera/mic/speaker); test mic/speaker in pre-join.
- **Reactions / emoji + raise hand.**
- Screen share (full screen / window).
- Chat with **inline P2P file transfer** (files render as chat cards).
- Participants panel.
- **Reconnection handling** — network drop → auto-rejoin.
- Empty states ("you're the only one here").

### 8.3 Efficiency / resilience
- **Low-bandwidth / audio-only mode** (offered at pre-join — [Brave model](https://mobbin.com/flows/4c06e78d-5117-453d-b182-e957d121a891)).
- **Watch-only** ("don't show video in tiles") — cuts CPU/bandwidth.
- **Noise suppression** levels (LiveKit Krisp, free).
- **Background blur** + adjustable radius slider (`@livekit/track-processors`), room to grow into full effects panel ([Zoom model](https://mobbin.com/screens/c7396598-319d-4bd9-8cfb-3e3b0156df24)).

### 8.4 Meeting lifecycle
- Meeting creation + **shareable link / room code**.
- Guest vs authenticated join paths.
- **Waiting room + room lock (both).** Waiting room = vetted entry; lock = hard close. Host chooses per meeting.
- "End for all" vs "Leave".

### 8.5 Moderation / safety
- Remove participant, force-mute, disable participant video.
- Report / block.

### 8.6 Accessibility (captions deferred; rest in scope)
- **Keyboard shortcuts + full keyboard navigation.**
- **Screen-reader / ARIA** pass.
- **Vision-assistive themes** (from §7).
- Focus management on island open/close.

### 8.7 Notifications / presence
- Browser notification for incoming call (ringing).
- Presence (online / in-call).
- Join/leave sound + toast.

### 8.8 Security — content plane (E2EE)
Per-room toggle (balances E2EE vs features):

| Mode | Gain | Give up |
|---|---|---|
| **Transport-only (default)** | Best scale; captions/future recording possible | Server could theoretically access media |
| **E2EE on** | SFU forwards ciphertext only; strongest confidentiality | No captions/recording; higher client CPU; best <40 people |

### 8.9 Deferred / out of scope
- **Live captions / transcription** — deferred (needs STT; conflicts with E2EE like recording). Accessibility focus now = keyboard/ARIA/vision themes.
- **Recording** — deferred (v1 decision unchanged).
- **Whiteboard / collaborative canvas** — out of scope. A **modular island slot is reserved** so it can be added later without rework.
- **Simultaneous multi-device** — future; identity model already supports it.

---

## 9. Security Model

**Transport:** all HTTP over TLS, all signaling over WSS (host-enforced). WebRTC media DTLS-SRTP encrypted in transit by default.

**Access:** short-lived JWTs (minutes) scope user to room + role. Waiting room vets guests; lock hard-closes. No anonymous SFU connection — token always required.

**Content:** per-room E2EE toggle (§8.8).

> **Honesty on resilience:** confidentiality and integrity are sound on free tier. Availability (redundancy, DDoS protection) is where paid infra eventually earns its place. LiveKit Cloud's managed infra already mitigates single-point-of-failure better than a single self-hosted VM would.

---

## 10. Capacity & Cost

### 10.1 Now (≤20)
LiveKit Cloud free tier handles ≤20 comfortably. Bandwidth cap is irrelevant at this size and usage.

### 10.2 Cost ladder
| Stage | Monthly | Trigger to move up |
|---|---|---|
| **Free tier (start here)** | $0 | Until sustained larger calls exceed free bandwidth/minutes. |
| LiveKit Cloud paid plan | ~$ per usage | Regular calls toward 50–100, or bandwidth cap hit. |
| Self-host option | infra cost | Only if data-residency/control demands it. Same SDK — no app rewrite. |

No architecture rework to scale — only a plan upgrade.

---

## 11. Build Roadmap

### Phase 1 — Foundations
- LiveKit Cloud project, Supabase Auth, frontend host.
- Token/Orchestrator API (auth + JWT minting, `userId#deviceId`).
- Working 1-on-1 call end to end.

### Phase 2 — Component system + core UI
- Design tokens + component library (§6) first — the anti-orphan foundation.
- Pre-join island, stage/tiles, Tier-0 control bar.
- Responsive grid + active-speaker. ClickUp/Runway styling.

### Phase 3 — Group features + panels
- Scale tests to 20; tune simulcast.
- Chat + P2P file transfer, participants panel (lazy-loaded), host island.
- Reactions, raise hand, layout switcher, pin/spotlight.

### Phase 4 — Differentiators
- Call merge (orchestrator + incoming banner + merge UI).
- Multi-device handoff.
- PiP, background blur + slider.

### Phase 5 — Security, theming, polish
- Waiting room + lock, moderation controls, E2EE toggle.
- Slack-model theming + vision-assistive themes.
- Accessibility pass (keyboard/ARIA), mobile sheet layouts, reconnection handling.

> **Next build step:** Phase 2 — a clickable React prototype of the island layout + token-driven component library. Validates the design language and the anti-orphan structure before media complexity or cost.
