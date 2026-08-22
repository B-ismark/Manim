import { useEffect, useState } from 'react'
import { isTouch } from '@/lib/device'

const SEEN_KEY = 'mn.coach.pin'

/**
 * One-time mobile hint teaching the touch gestures that have no visible
 * affordance: double-tap to pin a tile, tap/drag your own self-view. Shows once
 * (persisted in localStorage), auto-dismisses, and is tap-to-dismiss.
 *
 * Switching view is NOT in here any more, and shouldn't be: it used to be a swipe,
 * which is exactly the kind of invisible gesture that needs a coachmark to exist at
 * all. It's a labelled chip on the stage now, so there is nothing to teach.
 */
export function PinCoachmark() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isTouch()) return
    try {
      if (localStorage.getItem(SEEN_KEY)) return
    } catch {
      return
    }
    // Let the call settle before interrupting.
    const appear = window.setTimeout(() => setShow(true), 1500)
    const hide = window.setTimeout(() => dismiss(), 7500)
    return () => {
      window.clearTimeout(appear)
      window.clearTimeout(hide)
    }
  }, [])

  function dismiss() {
    setShow(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* storage blocked — show again next time, harmless */
    }
  }

  if (!show) return null

  // Positioned by TopStack — see the layer scale there.
  //
  // The max-width is load-bearing, not styling. TopStack anchors at
  // `top: max(1rem, safe-area)` and stretches `inset-x-0`, and a tile's own corner
  // controls sit at `left-2 top-2` / `right-2 top-2` at 44px on touch — so a pill
  // wide enough to reach the corners lands exactly on top of one. It did: on a
  // phone, a host's "Mute <name>" button on the first tile was completely covered
  // by this hint, and because the hint is `pointer-events-auto` (it is tap-to-
  // dismiss) it ATE the tap. Six seconds, once per device, on the first call
  // someone ever makes — i.e. precisely while they are poking at the UI.
  //
  // 4.5rem is derived, not picked: TopStack pads `px-4` (16px), so a centred pill
  // capped at `100% - 4.5rem` keeps 52px clear of each viewport edge, which is the
  // corner control's own extent (`left-2` = 8px, plus a 44px target). Expressed in
  // those units so it stays true at any width — it wraps to another line on a
  // narrow phone instead of growing into the corner. Widen this and you re-open the
  // collision; the `overlaps()` gate in 09-visual is what catches it.
  return (
    <button
      type="button"
      onClick={dismiss}
      className="mn-pop pointer-events-auto max-w-[calc(100%-4.5rem)] rounded-control bg-overlay px-3 py-2 text-center text-xs text-white shadow-raised backdrop-blur"
    >
      Double-tap a video to pin · tap your own to enlarge, drag to move
    </button>
  )
}
