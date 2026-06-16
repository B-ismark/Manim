import { useCallback, useEffect, useRef, useState } from 'react'

/*
  Document Picture-in-Picture — pops the *app UI* into a floating OS window (like
  Google Meet / Teams), not just a bare <video>. Chromium-only today; callers
  fall back to element PiP when `supported` is false.

  The panel itself is rendered by the caller via createPortal into
  `pipWindow.document.body`, so it stays inside the React + LiveKit provider tree
  (hooks/context keep working). This hook owns the window lifecycle + style copy.
*/

interface DocumentPictureInPicture {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>
  window: Window | null
}

function api(): DocumentPictureInPicture | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture ?? null
}

/** Clone the app's stylesheets + theme tokens into the PiP document. */
function copyStyles(win: Window) {
  const doc = win.document
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    doc.head.appendChild(node.cloneNode(true))
  })
  // Theme tokens are inline custom properties on <html>; carry them + the mode.
  doc.documentElement.style.cssText = document.documentElement.style.cssText
  const theme = document.documentElement.getAttribute('data-theme')
  if (theme) doc.documentElement.setAttribute('data-theme', theme)
  doc.body.style.margin = '0'
  doc.body.style.background = 'var(--color-stage)'
  doc.body.style.color = 'var(--color-ink)'
  doc.body.style.fontFamily = 'var(--font-sans)'
  // No stray scrollbars in the little window — the panel manages its own layout.
  doc.documentElement.style.overflow = 'hidden'
  doc.body.style.overflow = 'hidden'
}

export interface DocumentPipControls {
  supported: boolean
  active: boolean
  pipWindow: Window | null
  toggle: () => void
}

/**
 * @param autoArm when true (in an active call), auto-pop the Document-PiP window
 *   as the tab goes to the background. Desktop counterpart to mobile element-PiP
 *   (useAutoBackgroundPip). Driven by the MediaSession `enterpictureinpicture`
 *   action — Chromium fires it *with* user activation when you switch away from a
 *   media page, which is what lets `requestWindow` succeed without an explicit
 *   click. The bubble we auto-opened is closed again when you return.
 */
export function useDocumentPip(autoArm = false): DocumentPipControls {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const supported = typeof window !== 'undefined' && Boolean(api())
  // Mirror state for listeners (avoids stale closures); track auto-opened bubbles
  // so returning to the tab only closes one we opened, not a manual one.
  const winRef = useRef<Window | null>(null)
  winRef.current = pipWindow
  const autoOpened = useRef(false)

  const close = useCallback(() => {
    winRef.current?.close()
    setPipWindow(null)
  }, [])

  const open = useCallback(async () => {
    const dpip = api()
    if (!dpip || winRef.current) return
    try {
      // Landscape default — desktop camera/screen-share feeds are landscape, so
      // this fills the window instead of letterboxing a tall portrait frame.
      const win = await dpip.requestWindow({ width: 480, height: 320 })
      copyStyles(win)
      win.addEventListener('pagehide', () => setPipWindow(null))
      winRef.current = win
      setPipWindow(win)
    } catch {
      /* user dismissed / blocked — stay inline */
    }
  }, [])

  const toggle = useCallback(() => {
    if (winRef.current) close()
    else void open()
  }, [open, close])

  // Auto-enter on tab-away (desktop). Register the MediaSession action handler so
  // Chromium can invoke it with activation; close our auto-bubble on return.
  useEffect(() => {
    if (!autoArm || !supported || typeof navigator === 'undefined' || !navigator.mediaSession) return
    const ms = navigator.mediaSession
    try {
      ms.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
        autoOpened.current = true
        void open()
      })
    } catch {
      // Action unsupported on this browser — no desktop auto-PiP, manual button still works.
      return
    }
    const onVisibility = () => {
      if (!document.hidden && autoOpened.current) {
        autoOpened.current = false
        close()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      try {
        ms.setActionHandler('enterpictureinpicture' as MediaSessionAction, null)
      } catch {
        /* ignore */
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [autoArm, supported, open, close])

  // Close the PiP window if the component unmounts (e.g. leaving the call).
  useEffect(() => {
    return () => {
      winRef.current?.close()
    }
  }, [])

  return { supported, active: Boolean(pipWindow), pipWindow, toggle }
}
