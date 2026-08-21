import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Geometry of the DOCKED side panel, and the control bar's collision offset.
 *
 * Why this exists: opening the chat/people panel used to re-centre the control
 * bar in whatever space was left (`md:pr-[20rem] lg:pr-[22rem] xl:pr-[25rem]` on
 * a `fixed inset-x-0 flex justify-center` wrapper), which slid the WHOLE bar left
 * by half that padding — 160 / 176 / 200px. The Leave control sits 151–284px to
 * the right of the Chat button that triggers the reflow, so at every desktop
 * breakpoint the slide parked Leave under a pointer that had not moved: click
 * chat, click the same spot again to close it, and you have left the call. The
 * 8s Rejoin toast caught it, which made it a recurring annoyance rather than a
 * reported bug. Measurements and the rejected alternatives are in
 * docs/panel-reflow-findings.md; docs/prototypes/panel-reflow-rig.html re-runs
 * the whole sweep in a browser.
 *
 * The bar now moves only by the overlap it ACTUALLY has with the panel — which on
 * a 1440px screen is none at all, because the 614px bar and a 24rem panel both fit
 * with room to spare. At 1280px it is 75px, well short of the 151px that would
 * reach Leave.
 *
 * Below `xl` the bar does not move at all, because the panel stops ABOVE it
 * instead of sitting beside it. That is not a stylistic choice: at 1024px the
 * collision offset comes to 155px, which lands on Leave by 4px — the offset is
 * only ever as safe as the bar is narrow, and the bar grows as controls are
 * added. Taking the panel out of the bar's band removes the collision instead of
 * sizing around it. (An earlier pass put this threshold at `lg`, from a bar
 * measured at 560px in the prototype; the real bar is 614px, because the
 * prototype's mock was missing the Audio output button. useSettleGuard exists
 * precisely because that kind of drift is not detectable from the geometry.)
 *
 * The width below MUST match Sheet's `responsive` sideClass, and the breakpoint
 * must match where Sheet stops clearing the bar — the same layout decided in two
 * places, and changing one without the other silently re-opens the bug.
 */

/**
 * `right-3` / `top-3` — the gutter around the docked panel. (Its BOTTOM is
 * `bottom-3` only at `xl`; below that it stops well clear of the control bar —
 * see Sheet's `md:bottom-[5.75rem]`.)
 */
export const PANEL_GUTTER = 12
/**
 * Tailwind `xl`. Below this the panel STOPS ABOVE the control bar (Sheet's
 * `md:bottom-[5.75rem]`), so there is nothing for the bar to collide with and it
 * never moves. Only from `xl` is the panel full-height and beside the bar.
 */
const BESIDE_BAR_MIN = 1280
/** Tailwind `lg`. Below this the panel floats over the stage instead of docking it. */
const DOCKS_MIN = 1024

/**
 * The width of the panel the control bar can actually collide with — 0 at every
 * width where the panel stops above the bar rather than sitting beside it.
 */
export function collidingPanelWidth(vw: number): number {
  return vw >= BESIDE_BAR_MIN ? 384 : 0 // Sheet: xl:w-[24rem]
}

/**
 * How much horizontal room the docked panel takes away from the stage — mirroring
 * RoomView's `lg:pr-[22rem] xl:pr-[25rem]`. 0 below `lg`, where the panel floats
 * over the stage and takes nothing.
 *
 * Callers ADD this back before deciding how many tiles fit, so that docking the
 * panel can only ever shrink tiles — never page people out of the call. Deciding
 * capacity from the narrowed width is what used to drop four people to page 2 at
 * 1024px the moment you opened chat.
 */
export function dockedStageInset(vw: number): number {
  if (vw < DOCKS_MIN) return 0
  return vw >= BESIDE_BAR_MIN ? 400 : 352 // RoomView: lg:pr-[22rem] · xl:pr-[25rem]
}

/** Viewport width, re-read on resize. */
export function useViewportWidth(): number {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vw
}

/**
 * How far left a viewport-centred bar of `barW` must move to clear the docked
 * panel. 0 when it already clears it, and 0 wherever the panel overlays instead
 * of docking. Pure so the collision can be tested without a browser.
 */
export function barDockShift(vw: number, barW: number): number {
  const panel = collidingPanelWidth(vw)
  if (!panel || !barW) return 0
  const panelLeft = vw - panel - PANEL_GUTTER
  return Math.max(0, Math.round(vw / 2 + barW / 2 + PANEL_GUTTER - panelLeft))
}

/**
 * How far left the control bar must move to clear the docked panel — 0 whenever
 * it already clears it, which is the common case on a real desktop.
 *
 * Returned as a transform rather than as wrapper padding on purpose. Padding
 * shrinks the space the bar is centred in, and the bar is a flex item: past a
 * certain width it would start shrinking, which would change the overlap, which
 * would change the padding. A transform cannot feed back into the measurement.
 */
export function useBarDockShift(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el || !open) return setShift(0)
      // Border box. A ResizeObserver's contentRect would drop the island's px-3
      // and its border — ~26px — and under-shift by more than the margin we have.
      setShift(barDockShift(window.innerWidth, el.getBoundingClientRect().width))
    }
    measure()
    window.addEventListener('resize', measure)
    // The bar's width is content-driven and changes mid-call — a share starts and
    // Annotate appears, the host locks the room and the lock pill appears. A width
    // measured once at open would silently under-shift from then on.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (ro && ref.current) ro.observe(ref.current)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [open])

  return { ref, shift }
}
