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
  return (
    <button
      type="button"
      onClick={dismiss}
      className="mn-pop pointer-events-auto rounded-control bg-overlay px-3 py-2 text-center text-xs text-white shadow-raised backdrop-blur"
    >
      Double-tap a video to pin · tap your own to enlarge, drag to move
    </button>
  )
}
