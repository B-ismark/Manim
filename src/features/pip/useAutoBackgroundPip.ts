import { useEffect, useRef } from 'react'
import { isTouch } from '@/lib/device'

/*
  Auto picture-in-picture on mobile: when the user leaves the call (home button /
  app switcher / another tab), pop the active speaker's video into the OS PiP
  window so the call keeps playing in a floating bubble; restore it inline when
  they come back. This is the mobile counterpart to the desktop Document-PiP
  button — phones don't support Document PiP, so we use element PiP
  (requestPictureInPicture on Chromium/Android, webkitSetPresentationMode on iOS
  Safari).

  Trigger is `visibilitychange` → document.hidden. Browsers normally require a
  user gesture for requestPictureInPicture, but grant an "auto-PiP" exception to
  conferencing pages that have registered media-session handlers (we do, via
  useMediaSessionControls) while leaving the tab. Where the exception isn't
  granted the call is simply caught and we stay inline — never throws into the UI.
*/

type WebkitVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void
  webkitSupportsPresentationMode?: (mode: string) => boolean
}

/** Largest currently-playing <video> on the stage — the one worth floating. */
function pickStageVideo(): HTMLVideoElement | null {
  const vids = Array.from(document.querySelectorAll('video')).filter(
    (v) => v.readyState >= 2 && v.videoWidth > 0 && !v.paused && !v.disablePictureInPicture,
  )
  if (!vids.length) return null
  const area = (v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect()
    return r.width * r.height
  }
  return vids.sort((a, b) => area(b) - area(a))[0]
}

function canElementPip(): boolean {
  if (typeof document === 'undefined') return false
  if (document.pictureInPictureEnabled) return true
  const probe = document.createElement('video') as WebkitVideo
  return typeof probe.webkitSetPresentationMode === 'function'
}

/**
 * @param active whether a call is currently joined — only arm the listener then.
 */
export function useAutoBackgroundPip(active: boolean) {
  // Track whether *we* opened PiP, so returning to the foreground only closes the
  // bubble we auto-opened (don't fight a user who opened PiP themselves).
  const autoOpened = useRef(false)

  useEffect(() => {
    if (!active || !isTouch() || !canElementPip()) return

    async function enter() {
      if (document.pictureInPictureElement) return
      const video = pickStageVideo() as WebkitVideo | null
      if (!video) return
      try {
        if (typeof video.requestPictureInPicture === 'function') {
          await video.requestPictureInPicture()
        } else if (typeof video.webkitSetPresentationMode === 'function') {
          video.webkitSetPresentationMode('picture-in-picture')
        } else {
          return
        }
        autoOpened.current = true
      } catch {
        // No auto-PiP grant (no gesture exception) — stay inline silently.
      }
    }

    async function exit() {
      if (!autoOpened.current) return
      autoOpened.current = false
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture()
        } else {
          const v = document.querySelector('video') as WebkitVideo | null
          v?.webkitSetPresentationMode?.('inline')
        }
      } catch {
        /* already closed */
      }
    }

    function onVisibility() {
      if (document.hidden) void enter()
      else void exit()
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      // Leaving the call while backgrounded → tidy up our bubble.
      void exit()
    }
  }, [active])
}
