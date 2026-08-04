# Manim — agent guide

LiveKit video-call app. React + Vite + Tailwind (oklch design tokens), Cloudflare
Workers backend (`worker/`, shared core in `server/`).

## 🛑 LiveKit testing FROZEN (since 2026-06) — quota near limit
**Do NOT run anything that connects to LiveKit** until this banner is removed.
Every connection burns monthly participant-minutes and we're close to the cap.
- **Forbidden** (connect to real LiveKit): `npm test` · `npm run test:mobile` ·
  `npm run test:mobile-sm` · `npm run test:a11y` · `npm run test:visual` ·
  `npm run test:stress` · `npm run loadtest` · `npm run dev` **with** LiveKit creds.
- **Allowed** (no LiveKit): `npm run typecheck` · `npm run test:unit` ·
  `npm run lighthouse` · `node audit/responsive-audit.mjs` · `npm run dev` **without**
  creds (in-call UI absent, but landing/prejoin/static work).
- **Allowed: the FULL suite against a LOCAL LiveKit** — the freeze protects the *cloud*
  project's minutes, and a localhost server can't touch them. Grab a
  [`livekit-server`](https://github.com/livekit/livekit/releases) (**≥1.10** — 1.9 and
  older 404 the `/rtc/v1` route the client uses), then:
  ```bash
  livekit-server --dev            # devkey / secret on :7880
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  LIVEKIT_URL=ws://127.0.0.1:7880 VITE_LIVEKIT_URL=ws://127.0.0.1:7880 npm run dev
  # then, in another shell, the same 4 vars prefixed onto any gated command:
  LIVEKIT_URL=ws://127.0.0.1:7880 VITE_LIVEKIT_URL=ws://127.0.0.1:7880 npm test
  ```
  The guard hook allows a command only when **every** LiveKit URL on it is inline and
  local — mixing a local client URL with a cloud server URL still blocks, because that
  combination would bill the cloud project. Verified 2026-08: **49/54 desktop and 48/52
  mobile** specs pass this way. Every failure is environmental, not a product fault —
  four are the Krisp noise-filter model failing to load in a network-restricted sandbox
  (any spec asserting a clean error sink: `04-chat`, `06-multiparty`, sometimes
  `03-controls`), and `12-resilience` injects a connection fault that doesn't reproduce
  against a local server. Confirm anything you suspect by stashing your change and
  re-running: these all fail identically on an unmodified tree.
- **CI**: the `e2e` and `loadtest` jobs are gated behind repo variable
  `LIVEKIT_TESTS=true` (unset → skip). `typecheck` still runs every push.
- **Re-enable** only on explicit owner say-so: set `LIVEKIT_TESTS=true` and delete
  this banner.

## Testing / QA
**Before testing or auditing the app, read [QA-PLAYBOOK.md](QA-PLAYBOOK.md)** — it has
the full process, commands, parameters, pass criteria, and the hard-won conventions.
Setup (test LiveKit project + secrets) is in [TESTING.md](TESTING.md).

Quick reference (⚠️ LiveKit gates frozen — see banner above):
- Full local QA needs LiveKit test creds via **shell env** (don't edit `.env`):
  `LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… LIVEKIT_URL=… VITE_LIVEKIT_URL=… npm run dev`
- Gates: `npm run typecheck` · `npm test` (desktop) · `npm run test:mobile` ·
  `npm run test:mobile-sm` · `npm run test:a11y` · `npm run test:visual` ·
  `npm run lighthouse` · `npm run loadtest` (scale).

## Must-know constraints
- **Never `vite build` / deploy locally.** It aborts on empty `VITE_LIVEKIT_URL` by
  design; prod builds on Cloudflare from `main`. `tsc -b --noEmit` is the compile gate.
- **Verify deploys against the served artifact**, not a green build.
- **Mobile = pure touch**: no Esc / hover / keyboard shortcuts. Sheets close via the
  "Close panel" X; the control bar auto-hides (tap to reveal); More is a modal sheet.
- **No page scroll** on primary surfaces (landing, prejoin, in-call) — exceptions:
  the chat message list and menus scrolling *internally*. Check the short phone (`mobile-sm`).
- **Screen annotation is ON.** `VITE_ANNOTATE=false` is the kill switch — the flag is a
  disable, not an enable, so an unset build var still ships it. Strokes are ephemeral:
  they fade after ~4s, which is *why* there is deliberately no persistence, no
  late-joiner sync and no clear-all. Desktop draws, touch is view-only, a host can
  restrict drawing with the `annotateHostOnly` room flag, and a presenter sees their own
  share only while the pen is armed. Stroke data must never reach React state or a store
  — read the header of `AnnotationEngine.ts` before touching it.
- **Design decisions → check Mobbin** (Meet/Teams/Zoom/WhatsApp) before guessing.
- A11y is gated (axe, light + dark); contrast tokens are oklch — compute real WCAG
  ratios when changing them (see QA-PLAYBOOK §3).

## Branch hygiene — don't strand work
Work landing on a feature branch but never reaching `main` is a recurring failure.
- **Finish = merged.** When a task is done and gates pass, merge to `main` (fast-forward
  or PR) and push. Don't leave the only copy on a feature branch.
- Check before ending: `npm run unmerged` (lists commits on HEAD not yet on `origin/main`).
- A `Stop` hook (`.claude/settings.json`) warns automatically when unmerged commits exist.
