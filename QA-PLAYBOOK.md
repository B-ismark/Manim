# QA Playbook — Manim

> ## 🛑 LiveKit testing is FROZEN — quota near limit
> **Do not run any layer marked "Creds: yes" below**, and do not `npm run dev`
> with LiveKit creds. The authoritative freeze banner — exactly what is forbidden,
> what is still safe, and how to lift it — lives in **[CLAUDE.md](CLAUDE.md)**.
> Keep it in that one place; don't restate the rules here, they drift.

A replicable QA process for this LiveKit video-call app, written so a future
Claude agent (or any engineer) can re-run the full audit and know *what* to test,
*how*, with *which parameters*, and *what counts as a pass*. Pair with:
- [TESTING.md](TESTING.md) — environment setup (test LiveKit project + secrets).
- [E2E-FINDINGS.md](E2E-FINDINGS.md) — the original sweep + capacity findings.

> **Golden rule:** the in-call UI only exists with LiveKit creds. Verify behaviour
> against the **running app / served artifact**, never a green build alone.

---

## 0. Prerequisites

| Need | How |
|---|---|
| Test LiveKit project | Separate from prod (free tier ok). Never load-test prod. |
| GitHub secrets | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `VITE_LIVEKIT_URL` (the test project). |
| Local in-call | Inject the same 4 vars via **shell env** (don't edit `.env`): dotenv won't override shell vars, so `LIVEKIT_*=... VITE_LIVEKIT_URL=... npm run dev`. |
| Browsers | `npx playwright install chromium`. (We do NOT use the WebKit `iPhone SE` device — `mobile-sm` is Chromium at 375×667.) |
| Build/deploy | Prod builds on Cloudflare from `main`. `vite build` aborts on empty `VITE_LIVEKIT_URL` by design — never deploy a local build. `tsc -b --noEmit` is the local compile gate. |

---

## 1. Test layers (the matrix)

| Layer | Command | Creds | Where | Pass criteria |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | no | CI `typecheck`, always | 0 errors |
| Functional E2E (desktop) | `npm test` | in-call yes | CI `e2e` | all pass |
| Functional E2E (mobile, Pixel 7) | `npm run test:mobile` | yes | CI `e2e` | all pass |
| Real-estate fit (iPhone-SE size) | `npm run test:mobile-sm` | yes | CI `e2e` | no page scroll |
| Accessibility (axe, light+dark) | `npm run test:a11y` | in-call yes | CI `e2e` | **0 violations** |
| Visual + edge cases (screenshots) | `npm run test:visual` | yes | CI `e2e` | no overlaps; shots uploaded |
| Lighthouse budgets (landing+prejoin) | `npm run lighthouse` | build var | CI `lighthouse` | perf≥0.85 warn / a11y≥0.9 / bp≥0.95 / seo≥0.95 (landing) |
| Scale stress (50+) | `npm run loadtest` + observe | yes | CI `loadtest` (manual) | host UI clean, no overlaps |
| Capacity ramp (browser, ≤12) | `npm run test:stress` | yes | gated `STRESS=1` | informational |

`@heavy` specs (visual + load-test-observe) are excluded from the fast functional
gate; run them via `test:visual`. Spec files live in [tests/](tests/); shared
helpers + every convention below are in [tests/helpers.ts](tests/helpers.ts).

---

## 2. The audit process (run this to "QA the app")

1. **Bring up the app** with test creds (shell env, §0) → `npm run dev` (vite :5173 + token :3001).
2. **Static gate:** `npm run typecheck`.
3. **Responsive/overlap sweep** (no creds needed): `node audit/responsive-audit.mjs`
   — landing + prejoin across 10 viewports + a resize sweep → `audit/responsive-audit.json` + `audit/shots/`. Read the shots.
4. **Functional + a11y:** `npm test`, `npm run test:mobile`, `npm run test:mobile-sm`.
5. **Visual review:** `npm run test:visual` → review `audit/scenarios/*.png` (an agent can `Read` PNGs — actually look at them, don't trust pass/fail alone).
6. **Lighthouse** on the deployed site (real numbers) — see §4.
7. **Scale:** trigger the `loadtest` workflow (Actions → Run workflow) or `npm run loadtest` + observe; review the host screenshot artifact.
8. **When a design choice is unclear → Mobbin** (§5).
9. **Fix findings**, re-run the affected layer, push. **Verify the deploy against the live artifact** (§4).

---

## 3. Conventions & gotchas (the hard-won rules — honor these)

**Mobile = pure touch.** Phones have **no Esc key, no hover, no keyboard shortcuts**.
In tests:
- Close sheets by tapping the **"Close panel" X** (`closePanel()`), never `Escape`.
- The control bar **auto-hides after ~4s** on touch — call `revealChrome()` (a real
  `touchscreen.tap` on the top scrim) before tapping a control.
- The **More menu is a modal bottom-sheet** on mobile; its scrim blocks everything
  behind it (e.g. the waiting-room Admit banner) — close it before the next action.
- On desktop these are no-ops (controls always shown; panel is a non-modal dock).

**No page scroll.** Primary surfaces (landing, prejoin, in-call solo/grid, More-open)
must **fit the viewport** — the page must not scroll. Allowed exceptions: the **chat
message list** and a long **menu/settings sheet scrolling *internally*** (the page
still doesn't move). Enforced by [tests/11-mobile-fit.spec.ts](tests/11-mobile-fit.spec.ts)
on `mobile` + `mobile-sm`. A tall phone (Pixel 7) hides short-phone overflow — always
check `mobile-sm` (375×667) too.

**Overlap detection.** Use `overlaps()` (in helpers): it parks the mouse and uses
`element.checkVisibility()` so buttons inside an **opacity-0 / hidden ancestor**
(closed effects carousel, retracted hover controls) are correctly ignored.
Element-only opacity checks produce false positives in-call.

**Large-room tile grid (paged).** Fit-to-viewport pages; navigation is **left/right
EDGE arrows** (Zoom model) — NOT a bottom-centre pager (that collides with the
floating control bar). `perPage` is **capped** (20 desktop / 9 mobile) so pagination
always engages at scale regardless of the measured grid height, which also bounds
mounted `<video>`/DOM per page. Verified at 50 participants via load-test.

**Accessibility / colour contrast.** Tokens are **oklch** in
[src/styles/app.css](src/styles/app.css) (light defaults) + [src/styles/themes.ts](src/styles/themes.ts)
(baseDark/baseLight overrides, applied to `<html>`). To pick AA-passing values,
compute real WCAG contrast: convert oklch→linear sRGB→relative luminance→ratio
(matches Lighthouse to 2 decimals). Watch the **fill-vs-text conflict**: a colour
used as a *fill with white ink* (Leave/mute buttons, accent buttons) needs to be
*dark enough*; the same token used as *text on a dark surface* needs to be *light*.
Don't lighten a fill token to fix text — they need separate values. axe in
[tests/08-a11y.spec.ts](tests/08-a11y.spec.ts) runs **light AND dark** and catches
these automatically.

**Scale testing.** One machine saturates at **~8 real headless Chromium** (CPU-bound
— a harness limit, not the product's). For real scale use **`lk load-test`**
(server-side sim participants, no browsers) + the host-observe spec
([tests/10-loadtest-observe.spec.ts](tests/10-loadtest-observe.spec.ts)). Keep the
browser participant ramp ≤5–7.

**Flake.** Real LiveKit + WebRTC negotiation is occasionally flaky under load.
CI uses `retries: 1`; run WebRTC specs with `--workers=1`. Ignore teardown noise
(`ConnectionError` / "abort handler called") — already filtered in `appErrors()`.

**Design decisions → Mobbin.** See §5.

---

## 4. Lighthouse + deploy verification

- **Local-ish:** `npm run lighthouse` (lhci) builds the preview and asserts the
  [lighthouserc.json](lighthouserc.json) budgets. SEO is asserted on landing only —
  rooms (`/r/*`) are intentionally `Disallow`-ed in `robots.txt`, so they score ~63
  ("blocked from indexing"), which is correct.
- **Real numbers on prod:** run Lighthouse against the deployed URL with a local
  Chrome: `CHROME_PATH="<chrome.exe>" npx -y lighthouse@latest "<url>" --preset=desktop ...`
  (and again without `--preset` for mobile). Google PageSpeed's keyless API quota is 0 — don't rely on it.
- **After any deploy:** confirm the change is in the **served artifact** (e.g.
  `curl <url>/robots.txt`, grep the HTML for the meta tag, check the prejoin route's
  static JS doesn't statically import the livekit chunk). A green build ≠ a good deploy.

---

## 5. Using Mobbin for design calls

When a UI/UX/layout decision is unclear ("how should the pager look", "how big is the
prejoin preview", "where do tile controls go"), check how Meet / Teams / Zoom /
WhatsApp / Brave Talk handle it via the **Mobbin MCP** (`search_screens` /
`search_flows`) before guessing. Examples validated this way: paged-grid nav = Zoom
edge arrows (Meet/Teams don't bottom-pager); prejoin preview+toggles+name+join stack
matches Brave Talk / Zoom.

---

## 6. Known limits / non-goals

- In-call cannot run without LiveKit creds (blank local `.env` strips the UI).
- Browser-based participant scale ceiling ≈ 8 on one machine — use `lk load-test`.
- WebKit isn't installed; `mobile-sm` is Chromium at the SE viewport (size is what
  matters for the fit checks, not the engine).
- `07-capacity` (12 browser contexts) is `STRESS`-gated and superseded by load-test.
- Free-tier LiveKit: don't run load-test + the full e2e concurrently against the same
  project (join contention flakes the e2e).

---

## 7. Artifacts

- `audit/scenarios/*.png` — visual scenario + load-test host screenshots (gitignored; uploaded by CI as `scenario-screenshots` / `loadtest-results`).
- `audit/responsive-audit.json`, `audit/shots/` — responsive sweep output (gitignored).
- `playwright-report/` — HTML report + traces (CI artifact). Open with `npx playwright show-report`.
- Lighthouse → temporary-public-storage link in the `lighthouse` job log.
