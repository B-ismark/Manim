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
  // 6rem is derived from a MEASUREMENT, and the measurement is the part worth
  // keeping: a tile's top-left control occupies x 16..60 on touch — the stage
  // insets the tile 8px, the control sits `left-2` (8px) inside that, and it is a
  // 44px target. (Two earlier attempts at this number came from reasoning about
  // `left-2` alone and both left a few pixels of overlap.)
  //
  // TopStack pads `px-4` (16px), so a centred pill capped at `100% - Crem` sits
  // exactly `16 + C/2` from each viewport edge AT EVERY WIDTH — the cap and the
  // centring cancel the viewport out. 6rem puts it at 64px, clearing the 60px band
  // by 4px, so no device-pixel-ratio rounding can reintroduce an overlap. It wraps
  // to another line on a narrow phone rather than growing into the corner.
  //
  // Narrow this at your peril and widen it at the app's: 19-overlays asserts both
  // edges against that band at ZERO tolerance, because 09-visual's `overlaps()`
  // only reports an intersection above 20% of the smaller element's area and so
  // says nothing about a small one.
  return (
    <button
      type="button"
      onClick={dismiss}
      className="mn-pop pointer-events-auto max-w-[calc(100%-6rem)] rounded-control bg-overlay px-3 py-2 text-center text-xs text-white shadow-raised backdrop-blur"
    >
      Double-tap a video to pin · tap your own to enlarge, drag to move
    </button>
  )
}
