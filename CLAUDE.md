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
- **The stage is the Teams three-view model, on both pointer types.** SPEAKER (one
  large feed + a filmstrip along the TOP on desktop), GALLERY (equal tiles — paged on
  desktop, vertically SCROLLING on touch past a screenful), CONTENT (a share owns the
  stage; people on a right-hand rail when the stage is landscape, a bottom strip when
  it's portrait). `layout` in `useRoomStore` is ONE value across both pointer types —
  More → View and the touch stage's own view chip set the same thing. A live,
  undemoted share outranks it and gives you CONTENT; `demotedShares` is the per-viewer
  "not full-bleed" flag and the ONLY thing that switches away from a share, so route
  any new control through it rather than adding a second flag.
  - Strip/big geometry is `lib/shareLayout.ts` and is deliberately FIXED, not sized to
    the content's aspect — read its header before making it adaptive again.
  - The speaker filmstrip is at the TOP because the control island floats over the
    bottom; anything parked down there ends up half underneath it (it did, for months).
  - Gallery tile density comes from viewport WIDTH at a 132px legibility floor
    (`lib/tileGrid.ts`): 2 columns on every current phone, 3 from ~430px and on tablets.
- **On touch, you are the floating self-view card and NOT a gallery cell.** One of
  you, at ~33% of the viewport (tap → ~62%), on every view including a share. A cell
  as well would show you to yourself twice and cost somebody else their tile. Desktop
  has no floating card at all — every desktop layout already carries you as a real
  tile. There is deliberately **no swipe gesture** on the stage any more: the view chip
  is the route, and a gesture would have to fight the gallery's own scroll.
- **The control island must fit its viewport, and every control stays 44px.** Six 44px
  controls plus gaps and padding is 318px of the 343px available at 375px — there is
  almost no slack. Adding anything to the bar means measuring it (a labelled route chip
  and the host's split leave-and-end control both had to come off), and nothing on it
  may be a status indicator: those go in `TopStack`. `test:mobile-sm` asserts the fit.
- **A `hidden` class is INERT on any component with a base display class.** `cn()` is a
  plain joiner, so the className lands after the component's own `inline-flex`,
  Tailwind emits `.hidden` first, specificity ties and source order wins. Gate with a
  conditional render or a plain `<span>` wrapper — never `hidden pointer-fine:*` on an
  `IconButton`/`Button`. This shipped desktop-only device carets to phones for months.
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
  `modal` value, so two dialogs can't be open at once. The touch chrome also refuses to
  auto-hide while ANY Radix layer is open (`overlayOpen()` in `RoomView` — it asks the
  DOM, so a new control can't forget to opt in), and the audio picker is a tray *inside*
  the island whose last row is the control bar, so it can't outlive its anchor.
- **The invite link's #fragment is fragile — `lib/roomKeys.ts` is the safety net.**
  A URL has exactly one fragment, so a sign-in round trip (`redirectTo` +
  `#access_token=…`) overwrites the room's `#k=…&e=…`, and everything that shares
  `location.href` then hands out dead links. The link is the authority, this browser
  remembers it, and the recovered fragment is written BACK to the address bar — never
  over an auth fragment. Any new navigation to a room must carry secrets (`roomTo`),
  never a bare `/r/<slug>`.
- **`ConnectionQuality` is a bandwidth heuristic, not connection state.** It reports
  `Lost` for a packet-loss spike and the value sticks until the next update. Only
  `ConnectionState` (Reconnecting / SignalReconnecting) may be called "lost" in the UI
  — that's what the reconnect logic, the banner and the announcer all use. Quality may
  warn, after a hold, and the strongest thing it may say on its own is "weak".
- **Design decisions → check Mobbin** (Meet/Teams/Zoom/WhatsApp) before guessing.
- A11y is gated (axe, light + dark); contrast tokens are oklch — compute real WCAG
  ratios when changing them (see QA-PLAYBOOK §3).

## Branch hygiene — don't strand work
Work landing on a feature branch but never reaching `main` is a recurring failure.
- **Finish = merged.** When a task is done and gates pass, merge to `main` (fast-forward
  or PR) and push. Don't leave the only copy on a feature branch.
- Check before ending: `npm run unmerged` (lists commits on HEAD not yet on `origin/main`).
- A `Stop` hook (`.claude/settings.json`) warns automatically when unmerged commits exist.
