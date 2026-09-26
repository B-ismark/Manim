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

/** Ask for fullscreen on `el`, prefixed where that's the only API. False when the
 *  platform has neither, or the request threw synchronously. */
function request(el: HTMLElement, onRejected?: () => void): boolean {
  const w = el as WebkitElement
  try {
    const p = w.requestFullscreen ? w.requestFullscreen() : w.webkitRequestFullscreen?.()
    if (!w.requestFullscreen && !w.webkitRequestFullscreen) return false
    void Promise.resolve(p).catch(() => onRejected?.())
    return true
  } catch {
    return false
  }
}

function exitAny(): void {
  if (!fullscreenElement()) return
  const d = document as WebkitDocument
  try {
    const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()
    void Promise.resolve(p).catch(() => {})
  } catch {
    /* nothing to exit */
  }
}

/** The element currently fullscreen, live. Safari fires only the prefixed event,
 *  so listening to one alone left the state (and every exit button rendered off
 *  it) stuck on exactly the browsers that need the prefixed request. */
function useFullscreenElement(): Element | null {
  const [el, setEl] = useState<Element | null>(() => (typeof document === 'undefined' ? null : fullscreenElement()))
  useEffect(() => {
    const onChange = () => setEl(fullscreenElement())
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])
  return el
}

/** Document-level fullscreen toggle + live state (shared by the control bar and
 *  the on-stage exit button). */
export function useFullscreen() {
  const [supported] = useState(fullscreenSupported)
  const isFullscreen = Boolean(useFullscreenElement())
  const exitFullscreen = useCallback(() => exitAny(), [])
  const toggleFullscreen = useCallback(() => {
    if (fullscreenElement()) exitAny()
    else request(document.documentElement) // unsupported: the caller hides the control via `supported`
  }, [])
  return { supported, isFullscreen, toggleFullscreen, exitFullscreen }
}

/**
 * Fullscreen ONE element (the shared-screen tile), on the same primitives as the
 * document version above: there used to be a second copy in Stage, and it drifted
 * (it missed the prefixed change event, so on Safari the floating Exit, the only
 * way out on touch, never appeared). Where element fullscreen isn't available —
 * iPhone Safari only fullscreens a <video> — it falls back to the video's own.
 */
export function useElementFullscreen(ref: { current: HTMLElement | null }) {
  const active = useFullscreenElement()
  const isFs = active !== null && active === ref.current
  const enter = useCallback(() => {
    const el = ref.current
    if (!el) return
    const video = el.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    const toVideo = () => video?.webkitEnterFullscreen?.()
    if (!request(el, toVideo)) toVideo()
  }, [ref])
  const exit = useCallback(() => exitAny(), [])
  return { isFs, enter, exit }
}
