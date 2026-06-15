import { useEffect, useState } from 'react'
import { isTouch } from '@/lib/device'

const SEEN_KEY = 'mn.coach.pin'

/**
 * One-time mobile hint teaching the touch gestures that have no visible
 * affordance: double-tap to pin a tile, drag to move your self-view. Shows once
 * (persisted in localStorage), auto-dismisses, and is tap-to-dismiss.
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

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(3rem,calc(env(safe-area-inset-top)+2.5rem))] z-20 flex justify-center px-6">
      <button
        type="button"
        onClick={dismiss}
        className="mn-pop pointer-events-auto rounded-control bg-overlay px-3 py-2 text-center text-xs text-white shadow-raised backdrop-blur"
      >
        Double-tap a video to pin · drag your own to move · swipe to switch layout
      </button>
    </div>
  )
}
