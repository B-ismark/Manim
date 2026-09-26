import { useEffect, useState } from 'react'

/**
 * When did this page last come back to the foreground?
 *
 * A phone that was in another app for a while comes back with a stale picture of
 * the call: LiveKit's ConnectionQuality is a per-interval heuristic, and the
 * first readings after a return still describe the time the page was frozen
 * (no packets sent, none acknowledged). The status chip read that as "weak
 * connection" for several seconds on a line that was fine. Anything that judges
 * the connection asks this first and gives the return a grace period.
 *
 * One listener for the whole app, installed on first use.
 */
let returnedAt = 0
let installed = false

function install() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('visibilitychange', mark)
  // A restore from the back/forward cache doesn't always come with a visibility
  // change (iOS uses it aggressively).
  window.addEventListener('pageshow', mark)
}

/** Record a return. A first load's `pageshow` isn't one (not `persisted`). */
function mark(e: Event) {
  if (e.type === 'pageshow' && !(e as PageTransitionEvent).persisted) return
  if (document.visibilityState === 'visible') returnedAt = Date.now()
}

/** How long the grace after a return lasts. */
export const RETURN_GRACE_MS = 8000

/** Milliseconds of grace left after the last return to the foreground (0 = none). */
export function returnGraceLeft(now = Date.now()): number {
  install()
  if (!returnedAt) return 0
  return Math.max(0, returnedAt + RETURN_GRACE_MS - now)
}

/** Start listening now, so a return that happens before the first ask counts. */
export function watchForeground(): void {
  install()
}

/**
 * True while the page is inside its return grace. Re-renders when a return
 * starts one and again when it runs out, so a warning held back by it appears
 * on time if the reading is still bad.
 */
export function useReturnGrace(): boolean {
  const [, bump] = useState(0)
  useEffect(() => {
    install()
    let t: number | undefined
    const arm = () => {
      window.clearTimeout(t)
      const left = returnGraceLeft()
      bump((n) => n + 1)
      if (left > 0) t = window.setTimeout(() => bump((n) => n + 1), left + 50)
    }
    const onVisible = (e: Event) => {
      mark(e) // this listener may run before the module's
      arm()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    if (returnGraceLeft() > 0) arm()
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [])
  return returnGraceLeft() > 0
}
