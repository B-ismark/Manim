import { useEffect, useState } from 'react'

/**
 * How much of the bottom edge the on-screen keyboard covers.
 *
 * A `position: fixed; bottom: 0` element — the chat sheet, and the composer inside
 * it — is positioned against the LAYOUT viewport, and the software keyboard does
 * not shrink that. The default `interactive-widget` behaviour is
 * `resizes-visual`: the keyboard shrinks the VISUAL viewport and leaves the layout
 * viewport (and therefore `dvh`, `env(safe-area-inset-bottom)` and every `bottom-0`
 * anchor) exactly as it was. So the sheet stays put and the keyboard is drawn on
 * top of it — the composer you are typing into is underneath your own keyboard.
 *
 * That is worst in FULLSCREEN on a phone, which is where it was reported: there is
 * no browser chrome to absorb any of it, so the keyboard eats the bottom of the
 * app outright.
 *
 * The fix has to come from JS because CSS cannot see the visual viewport. The one
 * thing that can is `window.visualViewport`, and the overlap is the gap between
 * the two viewports at the bottom:
 *
 *     innerHeight - (visualViewport.height + visualViewport.offsetTop)
 *
 * `offsetTop` matters: a visual viewport scrolled down inside the layout viewport
 * (which is what a browser does to keep a focused field visible) has already made
 * up part of the difference, and ignoring it double-counts.
 *
 * Switching the viewport meta to `interactive-widget=resizes-content` would also
 * work, and is deliberately NOT what this does — it would shrink `100dvh` for the
 * whole app, so every `dvh`-sized surface (the stage, the tile packer's height
 * budget, the island's band) would reflow on every keystroke-opening keyboard.
 * Lifting one sheet is the smaller, more predictable change.
 */

/**
 * Below this, an apparent overlap is browser chrome (a collapsing address bar) or
 * rounding, not a keyboard. Reacting to those would make the sheet twitch while
 * you scroll; the smallest phone keyboard is several times this tall.
 */
const KEYBOARD_MIN = 80

/**
 * Pure overlap maths, so the guards are testable without a browser.
 *
 * `scale` is the pinch-zoom factor. A zoomed-in page reports a shorter visual
 * viewport for a reason that has nothing to do with a keyboard, and treating that
 * as one would shove the sheet up the screen while the user is just reading, so
 * anything but ~1:1 reports zero.
 */
export function keyboardOverlap(
  layoutHeight: number,
  visual: { height: number; offsetTop: number; scale: number },
): number {
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visual.height)) return 0
  if (Math.abs(visual.scale - 1) > 0.05) return 0
  const overlap = layoutHeight - (visual.height + visual.offsetTop)
  return overlap >= KEYBOARD_MIN ? Math.round(overlap) : 0
}

/**
 * Live keyboard overlap in px, 0 when no keyboard is up.
 *
 * Starts at 0 and only ever adds a bottom offset, so a browser with no
 * `visualViewport` (or one that never fires) renders exactly what shipped before.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport
    if (!vv) return
    const read = () =>
      setInset(
        keyboardOverlap(window.innerHeight, {
          height: vv.height,
          offsetTop: vv.offsetTop,
          scale: vv.scale,
        }),
      )
    read()
    vv.addEventListener('resize', read)
    // The keyboard opening also SCROLLS the visual viewport, and on iOS the scroll
    // is what lands last — without this the sheet settles at the offset from just
    // before the browser finished making room for the focused field.
    vv.addEventListener('scroll', read)
    window.addEventListener('orientationchange', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return inset
}
