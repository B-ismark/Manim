import { useEffect, type RefObject } from 'react'

/**
 * Where toasts start, so they queue BELOW whatever already owns the top of the
 * screen instead of printing over it.
 *
 * Toasts sit at z-60 (they must clear modal scrims), TopStack's banners at z-30,
 * and both used to anchor at the top edge: a "Guest joined" toast landed squarely
 * on the reconnect banner or the pin hint, and on a phone's prejoin a long one
 * covered the Back button. Toasts can't simply become TopStack rows (the layer
 * order forbids it), so this does the measuring instead: anything registered here
 * that STARTS in the top band pushes the toast column down to its bottom edge.
 * Something that starts lower (prejoin's card on a tall desktop) never collides,
 * so it doesn't count. The result is one CSS variable, `--toast-top`, read by the
 * Toasts container; with nothing registered it is unset and toasts keep their spot.
 */

/** An element whose top edge is above this (px) is in the toasts' band. */
const BAND_PX = 72
/** Space between the element and the first toast. */
const GAP_PX = 8

const tracked = new Set<Element>()
let observer: ResizeObserver | null = null
let frame = 0

function measure() {
  frame = 0
  let bottom = 0
  for (const el of tracked) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.top < BAND_PX) bottom = Math.max(bottom, r.bottom)
  }
  const root = document.documentElement.style
  if (bottom > 0) root.setProperty('--toast-top', `${Math.ceil(bottom + GAP_PX)}px`)
  else root.removeProperty('--toast-top')
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(measure)
}

/** Keep toasts clear of `ref`'s element while it's mounted (and `active`). */
export function useToastClearance(ref: RefObject<Element | null>, active = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !active || typeof ResizeObserver === 'undefined') return
    if (!observer) observer = new ResizeObserver(schedule)
    if (tracked.size === 0) window.addEventListener('resize', schedule)
    tracked.add(el)
    observer.observe(el)
    schedule()
    return () => {
      tracked.delete(el)
      observer?.unobserve(el)
      if (tracked.size === 0) window.removeEventListener('resize', schedule)
      schedule()
    }
  }, [ref, active])
}
