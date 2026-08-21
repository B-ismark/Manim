# Mobile control island — end-to-end audit

**Date:** 2026-08-21 · **Surface:** the floating bottom control bar in-call
(`src/islands/ControlBar.tsx`) on touch devices, plus everything reachable from it.

## How this was verified — and what wasn't

Read this before trusting a ✅.

- **Static trace** of every control from the tap target to the effect it produces.
  Complete; this is where all six findings came from.
- **A cascade harness** (headless Chromium, `Pixel 7` + `Desktop Chrome` contexts,
  the real compiled `app.css`) to settle the `hidden pointer-fine:*` question
  empirically rather than by reading Tailwind's emit order. Results inline below.
- **NOT verified in a live call.** LiveKit testing is frozen (see CLAUDE.md), and
  the documented escape hatch — a local `livekit-server --dev` — is unavailable
  here because this environment's egress policy returns 403 for GitHub release
  downloads. So the in-call surfaces were never rendered against a real room.
  Regression tests for the two fixed defects are in
  `tests/11-mobile-fit.spec.ts`; **they have not been executed.** They need
  `test:mobile` against a local server.

Every "broken" claim below is grounded in code plus, where the mechanism was in
doubt, the harness. Every "works" claim is a code-reading claim only.

## What the island holds on touch

Left to right, as rendered when `pointer: coarse`:

| # | Control | Opens | Status |
|---|---|---|---|
| 1 | Lock pill (host, when locked) | — (status only) | ✅ |
| 2 | Mic toggle | — | ✅ |
| 3 | ~~Audio options caret~~ | popover → nested dropdowns | ❌ **F2 — leaked onto touch** |
| 4 | Camera toggle | — | ✅ |
| 5 | ~~Camera options caret~~ | popover → nested dropdown | ❌ **F2 — leaked onto touch** |
| 6 | Audio output | popover (mic + speaker + Bluetooth + noise) | ⚠️ **F1, F3, F5** |
| 7 | Chat (+ unread badge) | side panel | ✅ |
| 8 | More | bottom sheet | ✅ (contents below) |
| 9 | Leave / host split-leave | dropdown (host only) | ✅ |

Correctly absent on touch: screen share (folded into More), annotate
(`canAnnotate` carries `!coarse`), the inline reaction picker, keyboard shortcuts.
Participants is deliberately not here — it lives on the top-right `StageTopBar`
count chip (WhatsApp convention), and that is its only mobile entry point.

Inside **More**: reactions + raise hand · share screen · mini player · full screen
(⚠️ **F4**) · lock room · waiting room · View (speaker/grid) ·
backgrounds & effects · audio & video · hide self view · videos first · incoming
video · settings.

---

## Findings

### F1 — The island abandons its own open menu ❌ *fixed*

**Repro:** join on a phone, open the Audio output picker, wait.
**Result:** at the 4s mark the island slides out of the thumb zone. The popover
stays exactly where it was — a menu floating over the stage, anchored to a control
bar that is no longer on screen, with no visible route back to it.

**Root cause.** `useStageChrome` (`RoomView.tsx`) pinned the chrome only for
controls that remembered to call `setChromeHold`: the More sheet, the host's
end-call caret, the effects carousel. The three device popovers on the bar never
did. Worse, the countdown is armed *on mount* and on every stage tap and by
nothing else — so a picker opened at t=3.9s had 100ms to live, and tapping a bar
control did not buy it any more time.

**Fix.** Two parts, both in `RoomView.tsx`/`ControlBar.tsx`:

1. `overlayOpen()` — the hide timer now re-checks the DOM at the moment it fires
   and re-arms instead of hiding while any Radix layer is up. Radix gives every
   popover/menu/sheet/dialog `role="dialog"` or `role="menu"` (verified in
   `@radix-ui/react-popover` and `@radix-ui/react-menu`), so one query covers all
   of them — *including controls that don't exist yet*. Wiring a fourth callback
   would have fixed these three and left the trap armed for the next one.
2. `onInteract` — touching the island restarts the countdown, so the bar can no
   longer vanish mid-gesture.

Checked that nothing permanent carries those roles (toasts are `role="status"`,
the coachmark and TopStack banners carry none), so the guard cannot pin the chrome
forever. The regression test asserts both halves: pinned while open, *and*
auto-hiding again once closed.

### F2 — Desktop-only device carets render on phones ❌ *fixed*

The mic and camera carets gated themselves with `className="hidden
pointer-fine:inline-flex"`. That is **inert on an `IconButton`**: `cn()` is a plain
string joiner, so the className lands *after* the component's own base
`inline-flex`; Tailwind emits `.hidden` (line 518 of the compiled sheet) before
`.inline-flex` (line 527); specificity ties; source order hands it to
`inline-flex`. Harness output:

```
Pixel 7        (coarse=true)   IconButton + "hidden pointer-fine:inline-flex"  → display:inline-flex, rendered:true
Desktop Chrome (coarse=false)  IconButton + "hidden pointer-fine:inline-flex"  → display:inline-flex, rendered:true
Pixel 7        (coarse=true)   <span>     + "hidden pointer-fine:inline-flex"  → display:none,        rendered:false
Pixel 7        (coarse=true)   IconButton + "pointer-fine:hidden"              → display:inline-flex, rendered:true  ✅ correct
```

So a `<span>` wrapper works, a bare `hidden` on any component with a base display
class does not, and `pointer-fine:hidden` works (media-query utilities are emitted
later). **This is the reported "tapping the microphone selector opens an awkward
drop-down"** — that caret was never meant to be on a phone. The control bar
already documents this exact trap for the screen-share button, which was fixed the
same way.

**Fix.** Render on `!touch` and delete the inert class. Nothing is lost: the mic
and speaker pickers stay reachable via Audio output, and all three devices via
More → "Audio & video".

Swept the rest of the codebase for the same shape — every other leading-`hidden`
className is on a plain `div`/`span`/`input`, which is fine.

### F3 — The mobile device picker is the wrong pattern ⚠️ *prototype, not fixed*

Even with F2 gone, the remaining mobile path is a **popover containing dropdowns
that open their own popovers**. Concretely, on a 375×667 phone: tap Audio output →
`role="dialog"` popover, `side="top"`, no `max-height` and no `overflow`, holding
two `DeviceRow`s that each open a further `DropdownMenu` (also `side="top"`, also
unbounded). Radix flips a panel that doesn't fit to the opposite side, so a tall
audio panel above a bottom-anchored bar can genuinely resolve *downward* — which
is the second half of the "breaks the down convention" report — and a machine with
five audio outputs produces a dropdown with no scroll container at all.

Not fixed here: replacing it is a visual change and needs sign-off. Prototype:
[`mobile-device-picker-prototypes.html`](mobile-device-picker-prototypes.html).

### F4 — "Full screen" threw on iPhone ❌ *fixed*

`lib/useFullscreen.ts` called `document.documentElement.requestFullscreen()`
unguarded with a `.catch()` for safety. On iPhone Safari that method does not
exist, so the call threw a **synchronous** `TypeError` before there was a promise
to catch. The More sheet's Full screen tile — reachable *only* on touch — raised
an uncaught error and did nothing, every time.

**Fix.** Capability-check (`supported`, and the tile is not rendered without it,
matching what screen-share does on iOS), guard the calls, and use the
webkit-prefixed API plus `webkitfullscreenchange` where that's the only one —
which also makes fullscreen actually work on iPad Safari, where it was being
declined. Stage's own per-tile fullscreen had guarded for this all along; that
asymmetry is what marks this as an oversight rather than a decision.

### F5 — "Audio output" promises routing iOS Safari can't do ⚠️ *not fixed*

`DeviceRow` returns `null` when the platform enumerates no devices of that kind,
and iOS Safari exposes no `audiooutput` devices and no `setSinkId`. `DeviceMenu`'s
own comment names this case. But the *button* is unconditional, so on an iPhone a
control labelled "Audio output" opens a panel containing no output control.

Not fixed: the honest options are to hide the button where output can't be
switched, or relabel it for what it actually offers there ("Audio"), and that's a
design call. Folded into the F3 prototype.

### F6 — Sub-44px targets on a touch-only surface ⚠️ *not fixed*

`MenuRow` and `DropdownItem` are ~36px tall; the View / gallery-size chips are
~32px. All clear WCAG 2.2 AA (2.5.8, 24px) so this is not a gate failure, but all
three miss the 44px iOS / 48dp Android guidance, and the More sheet is a
touch-only surface. Also inconsistent: `GridTile` is ~68px. Folded into the F3
prototype rather than changed unilaterally.

Minor, noted only: the Lock room and Waiting room tiles don't `closeMore()` while
every other item in the sheet does. Defensible (they're toggles you may hit twice,
and their state updates live) but it reads as an oversight next to Hide self view,
which is also a toggle and does close.

---

## Ledger

| | Finding | State |
|---|---|---|
| F1 | Island abandons its open menu | ✅ fixed + regression test (unrun) |
| F2 | Desktop carets leak onto touch | ✅ fixed + regression test (unrun) |
| F4 | Full screen throws on iPhone | ✅ fixed |
| F3 | Device picker is the wrong pattern | ✅ fixed — the island grows an audio tray |
| F5 | "Audio output" can't route on iOS | ✅ fixed — no output section, and the control renames itself |
| F6 | Sub-44px targets in the More sheet | ✅ fixed — `pointer-coarse:min-h-11` on menu rows and View chips |

## Related

- [`mobile-device-picker-prototypes.html`](mobile-device-picker-prototypes.html) — three
  replacements for the nested-dropdown picker (F3/F5/F6), benchmarked against Meet, Teams,
  Zoom, WhatsApp, FaceTime and Discord.
- [`mobile-video-layout-prototypes.html`](mobile-video-layout-prototypes.html) — the stage
  itself: screen-share, speaker, small group and 20+, with the geometry measured at 375×667.
- [`mobile-stage-resolved.html`](mobile-stage-resolved.html) — **the decisions**. Which
  prototypes were picked, which two needed amending, and the combination they resolve to
  (speaker view as page zero of a horizontal pager, width-gated tile density).
