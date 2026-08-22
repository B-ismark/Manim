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
  - There is deliberately **no user-facing density control.** More → View carried
    gallery-size chips (Auto / 4 / 9 / 16); every value they produced was clamped to
    the same fit-to-viewport answer `gridCapacity` computes, so they either did
    nothing or paginated a page with room to spare. They also forced `fitMixedRows`
    to keep a second, UNCAPPED pass (a picked count could exceed the column cap),
    which silently dropped the legibility floor. Don't re-add the chips; `R = n`
    always satisfies the cap, so the capped pack can never come back empty.
- **On touch there is exactly ONE of you on screen; WHICH one depends on the view.**
  GALLERY gives you a real cell, the way every desktop layout does and the way Teams
  and Meet tile you on a phone. SPEAKER and CONTENT have no cell of yours — one
  full-bleed feed, and a collapsible thumbnail rail — so those keep the floating
  self-view card, at ~33% of the viewport (tap → ~62%). The invariant is what to
  preserve, not the placement: a card AND a cell shows you to yourself twice, so
  `showSelfCard` in `TouchStage` stands the card down wherever the stage already
  tiles you. Desktop has no floating card at all. There is deliberately **no swipe
  gesture** on the stage any more: the view chip is the route, and a gesture would
  have to fight the gallery's own scroll.
- **The control island must fit its viewport, and every control stays 44px.** Six 44px
  controls plus gaps and padding is 318px of the 343px available at 375px — there is
  almost no slack. Adding anything to the bar means measuring it (a labelled route chip
  and the host's split leave-and-end control both had to come off), and nothing on it
  may be a status indicator: those go in `TopStack`. `test:mobile-sm` asserts the fit.
- **The band the stage reserves for the island is `useIslandBand()`, never a constant.**
  The island sits at `bottom: max(1rem, env(safe-area-inset-bottom))`, so its band is
  its height plus whichever offset wins. A hardcoded `76` (= `16 + 60`) is right only
  where the inset is 0 — true of every emulated device Playwright ships and of no phone
  with a home indicator, where the bar floats *above* its band and the last gallery row
  can't be scrolled clear of it. Emulators can't report an inset, so
  `11-mobile-fit` forces one onto the `[data-safe-area-probe]` element and the island
  together; that seam is the only way this class of bug is visible in a browser test.
- **A `hidden` class is INERT on any component with a base display class.** `cn()` is a
  plain joiner, so the className lands after the component's own `inline-flex`,
  Tailwind emits `.hidden` first, specificity ties and source order wins. Gate with a
  conditional render or a plain `<span>` wrapper — never `hidden pointer-fine:*` on an
  `IconButton`/`Button`. This shipped desktop-only device carets to phones for months.
- **A `fixed bottom-0` sheet must lift by `useKeyboardInset()`.** The software
  keyboard shrinks the VISUAL viewport, not the layout one (`interactive-widget`
  defaults to `resizes-visual`), so `bottom-0`, `dvh` and
  `env(safe-area-inset-bottom)` are all blind to it and the keyboard is simply drawn
  over whatever is anchored down there — which is how the chat composer ended up
  underneath it, worst in fullscreen where no browser chrome absorbs any of it. CSS
  cannot see this; only `window.visualViewport` can (`lib/keyboardInset.ts`, which
  credits a scrolled visual viewport and ignores pinch zoom + address-bar noise).
  `Sheet` applies it, and the max-height clamp travels WITH the offset or the sheet
  just grows off the top instead. Do NOT "fix" this with
  `interactive-widget=resizes-content` — that shrinks `100dvh` app-wide, so the
  stage, the tile packer's height budget and the island's band all reflow on every
  keyboard. `11-mobile-fit` stubs `visualViewport` to exercise it, since an emulated
  device can't raise a keyboard.
- **Background blur is a one-tap toggle on your own tile, and the processor is
  shared by context.** There is no effects carousel any more — it was a horizontal
  lens strip built for a gallery of effects that no longer exists (image backgrounds
  were removed for breaking the feed), so it had shrunk to None + Blur, both of
  which the Effects dialog already has. Blur STRENGTH and quality stay in More →
  Backgrounds & effects. There can only ever be ONE `useBackgroundBlur` (it owns a
  live camera processor); it lives in RoomView and reaches the tile through
  `BlurProvider` — a context, not a store, because a store has to MIRROR the hook's
  state and then the tile's toggle and the menu can disagree about what blur is
  doing. Note `@livekit/track-processors` fetches its MediaPipe WASM from a CDN, and
  that makes blur behave DIFFERENTLY depending on the runner: offline/sandboxed it
  can't build at all and degrades to `none` with a reported error (by design), while
  **CI can fetch it, so CI really runs the segmenter.** A test that switches blur on
  and then keeps driving the UI passes locally and times out on CI — MediaPipe on a
  shared two-core runner beside other browser contexts starves the page. Switch it
  back off before touching anything else (`11-mobile-fit`).
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
