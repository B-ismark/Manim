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
  combination would bill the cloud project. The suite passes this way — the local-server
  gaps that used to be shrugged off as "environmental" are now handled explicitly, so a
  failure here is a real failure:
  - The **Krisp noise filter is a LiveKit CLOUD entitlement.** Against a dev server it
    cannot authenticate and fails with `Could not authenticate … status 404`, which
    every spec asserting a clean error sink then reported (`04-chat`, `06-multiparty`,
    sometimes `03-controls`). This was long attributed to a network-restricted sandbox;
    it isn't — it happens on a fully-networked CI runner too. `appErrors()` tolerates it
    only when `LIVEKIT_URL` is local; against Cloud a Krisp failure is still a failure.
  - **`12-resilience`'s fault simulation needs Cloud.** A dev server emits no
    `reconnecting` event at all, so that one spec skips on a local server via
    `usingLocalLiveKit` rather than failing where it proves nothing.
- **CI**: `typecheck` runs every push. `e2e-local` runs the **full desktop suite** on
  every push and PR against a `livekit-server --dev` started on the runner — ungated,
  because a localhost server cannot touch the cloud project's minutes. The cloud-backed
  `e2e` and `loadtest` jobs stay gated behind repo variable `LIVEKIT_TESTS=true`
  (unset → skip).
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
  late-joiner sync and no clear-all. Desktop draws, touch is view-only, and a host can
  restrict drawing with the `annotateHostOnly` room flag. A presenter sees their own
  share the whole time they're sharing (with an Annotate button on the share tile) — a
  remote share still wins the big region. Stroke data must never reach React state or a
  store — read the header of `AnnotationEngine.ts` before touching it.
- **Overlay layering is centralised.** Top banners/pills are children of
  `TopStack` (one column, priority order) — never a new `fixed` + hand-picked
  z-index; the layer scale is documented in `TopStack.tsx`. ControlBar holds ONE
  `modal` value, so two dialogs can't be open at once.
- **Design decisions → check Mobbin** (Meet/Teams/Zoom/WhatsApp) before guessing.
- A11y is gated (axe, light + dark); contrast tokens are oklch — compute real WCAG
  ratios when changing them (see QA-PLAYBOOK §3).

## Branch hygiene — don't strand work
Work landing on a feature branch but never reaching `main` is a recurring failure.
- **Finish = merged.** When a task is done and gates pass, merge to `main` (fast-forward
  or PR) and push. Don't leave the only copy on a feature branch.
- Check before ending: `npm run unmerged` (lists commits on HEAD not yet on `origin/main`).
- A `Stop` hook (`.claude/settings.json`) warns automatically when unmerged commits exist.
