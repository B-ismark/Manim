import { useCallback, useEffect, useState } from 'react'

/*
  Document-level fullscreen, capability-checked.

  This used to call `document.documentElement.requestFullscreen()` unguarded, with
  a `.catch()` for safety. On an iPhone that method does not exist, so the call
  threw a synchronous TypeError before there was a promise to catch: the "Full
  screen" tile in the mobile More sheet — a control the user can only reach on
  touch — raised an uncaught error and did nothing, every time. Stage's own
  per-tile fullscreen had guarded for this all along, which is what makes the
  omission here an oversight rather than a decision.

  Two changes. `supported` lets a caller not offer the control at all where the
  platform has no fullscreen (the same choice screen-share makes on iOS: hide it
  rather than ship a button that silently fails), and the webkit-prefixed API is
  used where it's the only one — that's iPad Safari and older desktop Safari,
  where fullscreen genuinely works and we were declining to use it.
*/

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

function fullscreenElement(): Element | null {
  const d = document as WebkitDocument
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

/** Does this platform expose ANY way to go fullscreen? False on iPhone Safari. */
function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as WebkitElement
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

/** Document-level fullscreen toggle + live state (shared by the control bar and
 *  the on-stage exit button). */
export function useFullscreen() {
  const [supported] = useState(fullscreenSupported)
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(fullscreenElement()))
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(fullscreenElement()))
    document.addEventListener('fullscreenchange', onChange)
    // Safari fires only the prefixed event, so without this the state (and the
    // exit button that renders off it) never updated on the browsers that need
    // the prefixed request in the first place.
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  const exitFullscreen = useCallback(() => {
    if (!fullscreenElement()) return
    const d = document as WebkitDocument
    try {
      const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()
      void Promise.resolve(p).catch(() => {})
    } catch {
      /* nothing to exit */
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (fullscreenElement()) {
      exitFullscreen()
      return
    }
    const el = document.documentElement as WebkitElement
    try {
      const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.()
      void Promise.resolve(p).catch(() => {})
    } catch {
      /* unsupported — the caller hides the control via `supported` */
    }
  }, [exitFullscreen])

  return { supported, isFullscreen, toggleFullscreen, exitFullscreen }
}
