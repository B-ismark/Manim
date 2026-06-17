# Testing & QA harness

How the platform is exercised: end-to-end flows, multi-party simulation, scale
stress, automated accessibility, and visual/edge-case review. Most of it needs a
real LiveKit backend (the in-call UI only exists with creds), so there's a
**test LiveKit project** wired to CI — never point this at prod.

## Setup (one-time)

1. **Create a dedicated LiveKit Cloud project** for testing (free tier is fine).
   Keep it separate from prod so load-tests don't burn prod usage/quota.
2. **Add GitHub repo secrets** (Settings → Secrets → Actions) from that project:
   - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `LIVEKIT_URL` (e.g. `wss://manim-test-xxxx.livekit.cloud`)
   - `VITE_LIVEKIT_URL` (same wss URL — the client needs it; also unblocks the
     Lighthouse build job)
3. *(Optional, to run in-call tests locally)* create a gitignored `.env.test`
   with the same four vars and `node server/token.mjs` will mint test tokens.
   Without it, only the no-creds suites run locally (landing, prejoin, a11y of
   those, the responsive audit, Lighthouse of the deployed site).

## What runs where

| Layer | Command | Needs creds | CI |
|---|---|---|---|
| Functional E2E (flows, chat, controls, multi-party) | `npm test` | in-call ones do | `e2e` job |
| Accessibility (axe, WCAG 2.1 AA, light+dark) | `npm run test:a11y` | in-call ones do | `e2e` job |
| Visual scenarios + edge cases (screenshots) | `npm run test:visual` | yes | `e2e` job |
| Capacity ramp (browser-based, ≤~8 clean) | `npm run test:stress` | yes | — |
| **Scale stress** (lk load-test, hundreds) | `npm run loadtest` | yes | `loadtest` job (manual) |
| Lighthouse budgets (landing + prejoin) | `npm run lighthouse` | build var | `lighthouse` job |

`npm test` excludes `@heavy` specs (visual + load-test-observe) so the functional
gate stays fast; `npm run test:visual` runs exactly those, serially.

## Seeing the screens

Visual specs ([tests/09-visual.spec.ts](tests/09-visual.spec.ts)) shoot the host
screen into `audit/scenarios/*.png` at each state (solo, grid 2→7, chat-open,
long-name, poor-network, and in-call across light/dark × desktop/tablet/phone).
CI uploads them as the **scenario-screenshots** artifact. Locally they're written
straight to `audit/scenarios/` for review. Playwright also keeps a trace +
HTML report (`npx playwright show-report`) and screenshots/video on failure.

## Multi-party & edge cases

`newParticipant()` spins each peer in its own browser context with its own fake
camera/mic, all joining one room — real LiveKit, real subscriptions. The visual
ramp asserts **no UI overlaps** at every headcount and records `pageMetrics`
(tiles, decoding videos, JS heap). Edge helpers in [tests/helpers.ts](tests/helpers.ts):
`throttleNetwork` (CDP 3g/offline → reconnect + adaptive-quality paths),
`overlaps`, `setColorScheme`, `axeViolations`.

## Scale stress (past the browser ceiling)

One machine saturates at ~8 real headless Chromium (CPU-bound — a harness limit,
not the product's; see [E2E-FINDINGS.md](E2E-FINDINGS.md)). For real scale use the
official LiveKit CLI, which simulates participants server-side with no browser:

```bash
# floods a TEST room; host can watch live at $APP/r/<room>
PUBLISHERS=20 SUBSCRIBERS=50 DURATION=60s ROOM=stress-1 npm run loadtest

# in another shell: screenshot the host UI while the room is full
LOADTEST_ROOM=stress-1 npx playwright test 10-loadtest-observe --project=desktop
```

In CI, the **loadtest** job (Actions → Run workflow) does both: floods the room,
then runs the observe spec, and uploads the host screenshot + load-test stats.

## Accessibility

[tests/08-a11y.spec.ts](tests/08-a11y.spec.ts) runs axe-core (WCAG 2.1 A/AA) on
landing, prejoin, and in-call (solo + grid + chat-open) in **both** colour
schemes, asserting zero violations. This is the automated net for contrast / ARIA
/ focus regressions. Lighthouse ([lighthouserc.json](lighthouserc.json)) adds
budget gates on the public routes.
