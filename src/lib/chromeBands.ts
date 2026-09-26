import { useEffect, useLayoutEffect, useState } from 'react'
import { create } from 'zustand'
import { useIsTouch } from '@/lib/useIsTouch'
import { useMediaQuery } from '@/lib/useMediaQuery'

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

/** Read `env(safe-area-inset-<side>)` as a number. CSS resolves it; JS can't, so we
 *  ask the engine by giving a throwaway element that height and measuring it. */
function readSafe(side: 'top' | 'bottom' | 'right'): number {
  if (typeof document === 'undefined' || !document.body) return 0
  const probe = document.createElement('div')
  // Tagged so the e2e suite can force a non-zero inset with a stylesheet. Emulated
  // devices all report 0, so without a seam the one case this function exists for is
  // the one case that can never be exercised in a browser test. Inert in production.
  probe.setAttribute(side === 'bottom' ? 'data-safe-area-probe' : `data-safe-area-probe-${side}`, '')
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;' +
    `height:env(safe-area-inset-${side},0px)`
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return Number.isFinite(h) ? h : 0
}

/**
 * A safe-area inset, kept current across rotation.
 *
 * Starts at 0 and corrects on mount. That ordering is deliberate: 0 yields the
 * old constant, so the first paint is never worse than what shipped, and the
 * correction only ever adds padding.
 */
function useSafeArea(side: 'top' | 'bottom' | 'right'): number {
  const [inset, setInset] = useState(0)
  useLayoutEffect(() => {
    setInset(readSafe(side))
  }, [side])
  useEffect(() => {
    const read = () => setInset(readSafe(side))
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [side])
  return inset
}

/** The bottom safe-area inset (home indicator / gesture bar). */
export function useSafeAreaBottom(): number {
  return useSafeArea('bottom')
}

/** The top safe-area inset (notch / status bar). */
export function useSafeAreaTop(): number {
  return useSafeArea('top')
}

/**
 * Whether the touch call chrome has faded out.
 *
 * On a phone the island and the top pills auto-hide after a few seconds without a
 * touch (RoomView's useStageChrome, the only writer). While they're gone there is
 * nothing to reserve room for, so the bands below collapse to a thin gutter and the
 * video grows into the space the bars leave — Meet and FaceTime do the same. One tap
 * brings the bars back and the tiles step aside again. Always false on desktop,
 * whose chrome never hides.
 */
export const useChromeHidden = create<{ hidden: boolean; mutedCorner: boolean; topRowsH: number }>(() => ({
  hidden: false,
  mutedCorner: false,
  // Height of whatever TopStack is still showing (TopStack measures itself). The
  // timer pill leaves with the bars, but a Muted pill, a reconnect banner or a
  // "not encrypted" pill stays — and a hairline band would put the top row's
  // corner controls underneath it.
  topRowsH: 0,
}))

/**
 * The "Muted" pill's corner, sideways: 16px up (or the home-indicator inset), 32px
 * tall, and a gutter. Only while it's actually there (`mutedCorner`, set by the pill
 * itself), so an unmuted call gets the whole height back.
 */
export const MUTED_PILL_H = 32


/** What's left of either band while the chrome is hidden: a hairline gutter. */
export const HIDDEN_BAND = 8

/**
 * Vertical band TopStack's first row occupies: its 16px inset plus a 44px pill plus
 * a gutter. Only the FIRST row: the stack's banners (reconnecting, waiting room)
 * are transient and overlay, as overlays do.
 */
export const TOPSTACK_BAND = 68

/**
 * A phone on its side: the island leaves the bottom edge for a column on the right.
 *
 * Sideways, height is the scarce axis (a 390px-tall stage), and a 60px bar across
 * the bottom took a sixth of it off every tile. Width is what there's plenty of, so
 * the controls become a slim rail on the trailing edge, the way Meet, FaceTime and
 * the camera app all do it. "Short" is Material's compact height (under 480dp),
 * which every phone in landscape is and no tablet is, so a tablet keeps its bar.
 */
export const RAIL_QUERY = '(orientation: landscape) and (max-height: 479px)'

export function useRail(): boolean {
  const touch = useIsTouch()
  const sideways = useMediaQuery(RAIL_QUERY)
  return touch && sideways
}

/**
 * A rail too short for one column. Six 44px controls, their gaps, the divider and
 * the padding need ~341px; a 360px-wide Android phone in landscape Chrome has
 * ~280-300px once the browser's own bars are taken, and a scrolling column hid
 * Leave with no sign there was more. Below this the rail wraps into two columns
 * (three rows each), so everything stays reachable at full size.
 */
export const RAIL_TWO_COL_QUERY = '(max-height: 351px)'
/** What the second column adds: one 44px control and the 6px gap before it. */
export const RAIL_SECOND_COL = 50

export function useRailTwoCol(): boolean {
  const short = useMediaQuery(RAIL_TWO_COL_QUERY)
  return useRail() && short
}

/**
 * The island's band on this device, ready to spend as padding.
 *
 * `shown` asks for the band as it is with the bars UP, whatever they are doing now.
 * That's what a layout DECISION (how many per page, how many columns, scroll or
 * pack) must be made from: deciding it from the live band flipped a 3-4 person
 * gallery between two different trees every time the bars came and went, which
 * remounts every video. The live band only sizes the box the tiles glide into.
 */
export function useIslandBand(extra = 0, shown = false): number {
  const safe = useSafeAreaBottom()
  const hidden = useChromeHidden((s) => s.hidden) && !shown
  const mutedCorner = useChromeHidden((s) => s.mutedCorner) && !shown
  const rail = useRail()
  // Sideways with the bars away, the "Muted" pill sits in the bottom-left corner,
  // exactly where the bottom-left tile carries its name tag. Keep it a strip.
  if (mutedCorner) return Math.max(ISLAND_INSET, safe) + MUTED_PILL_H + HIDDEN_BAND + extra
  // Nothing sits on the bottom edge while the bars are away, or when they're a rail.
  return hidden || rail ? Math.max(HIDDEN_BAND, safe) + extra : islandBand(safe, extra)
}

/**
 * The rail's band down the right edge (0 unless `useRail`). The island is a 60px-wide
 * column at `right: max(1rem, safe-area-right)` — the same geometry as the bottom
 * bar, turned on its side — and the band collapses with it when the chrome hides.
 */
export function useRailBand(extra = 0, shown = false): number {
  const safe = useSafeArea('right')
  const hidden = useChromeHidden((s) => s.hidden) && !shown
  const rail = useRail()
  const twoCol = useRailTwoCol()
  if (!rail) return 0
  if (hidden) return Math.max(0, safe)
  return Math.max(ISLAND_INSET, safe) + ISLAND_H + (twoCol ? RAIL_SECOND_COL : 0) + extra
}

/**
 * The band a tiled layout keeps clear under TopStack's timer pill. The pill sits at
 * `top: max(1rem, safe-area-top)`, so the band follows the notch the same way the
 * island's follows the home indicator.
 */
export function useTopBand(shown = false): number {
  const safe = useSafeArea('top')
  const hidden = useChromeHidden((s) => s.hidden) && !shown
  const rows = useChromeHidden((s) => s.topRowsH)
  const up = Math.max(ISLAND_INSET, safe) + TOPSTACK_BAND - ISLAND_INSET
  if (!hidden) return up
  // Hidden, but a pill is still up: stop just under it rather than under the timer.
  // Never MORE than the bars-up band: a stack of banners overlays there (they're
  // transient), and hiding the bars mustn't be what shrinks the tiles.
  return rows > 0 ? Math.min(up, Math.max(ISLAND_INSET, safe) + rows + HIDDEN_BAND) : Math.max(HIDDEN_BAND, safe)
}
