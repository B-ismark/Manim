import { useEffect, useState } from 'react'
import { AnnotateIcon } from '@/components/icons'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useIsTouch } from '@/lib/useIsTouch'

/** How long the pill stays up. Long enough to read, short enough that it isn't
 *  competing with the thing it's pointing at. */
const SHOW_MS = 4500

/**
 * "Ada is drawing on the shared screen" — for the people who can't draw back.
 *
 * Touch is view-only in this feature and the pen control is hidden there entirely,
 * which is the right call (drawing has to capture touch, and that fights the control
 * bar's tap-to-reveal). But it left a phone user watching strokes appear and fade
 * over a shared screen with no label, no control and no explanation of what they were
 * looking at. The author's name is drawn beside the live stroke head — only while the
 * stroke is alive, which on a small screen is easy to miss.
 *
 * Desktop users don't need this: they have the pen in the control bar and on the
 * share tile, so ink is self-evidently a thing this app does.
 *
 * A child of TopStack, so it queues with the other top pills instead of picking its
 * own offset.
 */
export function RemoteInkPill() {
  const remoteInkBy = useAnnotateStore((s) => s.remoteInkBy)
  const clear = useAnnotateStore((s) => s.noteRemoteInk)
  const touch = useIsTouch()
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    if (!remoteInkBy || !touch) return
    setShown(remoteInkBy)
    // Clear the store too, so the SAME author drawing again after the cooldown
    // re-triggers this rather than being swallowed by an unchanged value.
    const t = window.setTimeout(() => {
      setShown(null)
      clear(null)
    }, SHOW_MS)
    return () => window.clearTimeout(t)
  }, [remoteInkBy, touch, clear])

  if (!shown) return null
  return (
    <span className="flex items-center gap-2 rounded-control bg-overlay px-3.5 py-1.5 text-sm font-medium text-white shadow-pop backdrop-blur [&_svg]:size-4">
      <AnnotateIcon />
      {shown} is drawing on the shared screen
    </span>
  )
}
