import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * How much room the floating chrome takes out of the stage.
 *
 * The control island is `position: fixed` at
 * `bottom: max(1rem, env(safe-area-inset-bottom))`, so the band it occupies is its
 * own height plus whichever of those two offsets wins. Stage used to reserve a flat
 * `76px` for it, which is exactly `16 + 60` — correct, and only correct, on a device
 * whose bottom inset is zero.
 *
 * Every phone shipped with a home indicator or gesture bar has a non-zero one (~34px
 * on iOS, ~24px on Android gesture nav). There the island floats HIGHER than the
 * reserved band, so the last row of a scrolling gallery cannot be scrolled clear of
 * it — you reach the end of the scroller with a tile still underneath the bar. The
 * emulated devices the e2e suite runs on all report an inset of 0, which is why this
 * survived a green suite: the constant and the island agreed on every viewport we
 * tested and on none of the ones people actually hold.
 *
 * So the band is computed from the same two quantities the island positions itself
 * with, rather than from a number that happens to equal their sum in one case.
 */

/**
 * The island's own height: an 8px pad, a 44px control, an 8px pad.
 *
 * The one measurement here that isn't read from the platform, because the island's
 * resting height is a design constant rather than a runtime value — and it must be
 * the RESTING height, not the live one. The island grows when the audio tray opens
 * (the tray is a row inside it), and reserving for that would reflow the whole
 * gallery every time somebody checked their output device. `tests/11-mobile-fit`
 * asserts this against the real rendered bar, so a change to the island's padding
 * fails a test instead of silently un-reserving the band.
 */
export const ISLAND_H = 60

/** The island's floor offset from the bottom edge — the `1rem` in its `max()`. */
export const ISLAND_INSET = 16

/**
 * Vertical band the control island occupies, measured up from the viewport's bottom
 * edge, given the device's bottom safe-area inset.
 *
 * `extra` is for callers that want a visible gutter above the bar rather than a tile
 * edge flush against it.
 */
export function islandBand(safeBottom: number, extra = 0): number {
  const inset = Number.isFinite(safeBottom) ? Math.max(0, safeBottom) : 0
  return Math.max(ISLAND_INSET, inset) + ISLAND_H + extra
}

/** Read `env(safe-area-inset-bottom)` as a number. CSS resolves it; JS can't, so we
 *  ask the engine by giving a throwaway element that height and measuring it. */
function readSafeBottom(): number {
  if (typeof document === 'undefined' || !document.body) return 0
  const probe = document.createElement('div')
  // Tagged so the e2e suite can force a non-zero inset with a stylesheet. Emulated
  // devices all report 0, so without a seam the one case this function exists for is
  // the one case that can never be exercised in a browser test. Inert in production.
  probe.setAttribute('data-safe-area-probe', '')
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return Number.isFinite(h) ? h : 0
}

/**
 * The bottom safe-area inset, kept current across rotation.
 *
 * Starts at 0 and corrects on mount. That ordering is deliberate: 0 yields the
 * old constant, so the first paint is never worse than what shipped, and the
 * correction only ever adds padding.
 */
export function useSafeAreaBottom(): number {
  const [inset, setInset] = useState(0)
  useLayoutEffect(() => {
    setInset(readSafeBottom())
  }, [])
  useEffect(() => {
    const read = () => setInset(readSafeBottom())
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])
  return inset
}

/** The island's band on this device, ready to spend as padding. */
export function useIslandBand(extra = 0): number {
  return islandBand(useSafeAreaBottom(), extra)
}
