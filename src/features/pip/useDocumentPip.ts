import { useCallback, useEffect, useState } from 'react'

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
}

export interface DocumentPipControls {
  supported: boolean
  active: boolean
  pipWindow: Window | null
  toggle: () => void
}

export function useDocumentPip(): DocumentPipControls {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const supported = typeof window !== 'undefined' && Boolean(api())

  const close = useCallback(() => {
    pipWindow?.close()
    setPipWindow(null)
  }, [pipWindow])

  const open = useCallback(async () => {
    const dpip = api()
    if (!dpip) return
    try {
      const win = await dpip.requestWindow({ width: 360, height: 540 })
      copyStyles(win)
      win.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(win)
    } catch {
      /* user dismissed / blocked — stay inline */
    }
  }, [])

  const toggle = useCallback(() => {
    if (pipWindow) close()
    else void open()
  }, [pipWindow, open, close])

  // Close the PiP window if the component unmounts (e.g. leaving the call).
  useEffect(() => {
    return () => {
      pipWindow?.close()
    }
  }, [pipWindow])

  return { supported, active: Boolean(pipWindow), pipWindow, toggle }
}
