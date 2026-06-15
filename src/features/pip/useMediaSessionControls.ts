import { useEffect } from 'react'
import { useLocalParticipant } from '@livekit/components-react'

/*
  Surface mic / camera / hang-up buttons in the browser's NATIVE picture-in-
  picture window and the OS media hub via the Media Session API. Document PiP
  (Chromium) renders our own PipPanel with real controls; this covers the
  element-PiP fallback (Safari/Firefox) and OS-level media controls, which can
  only show buttons the page registers as media-session actions. No-op where the
  conferencing actions aren't supported.
*/

// These conferencing actions + state setters aren't in every TS lib.dom yet.
interface ConferencingMediaSession {
  setActionHandler: (action: string, handler: (() => void) | null) => void
  setMicrophoneActive?: (active: boolean) => void
  setCameraActive?: (active: boolean) => void
}

export function useMediaSessionControls(onLeave: () => void) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: ConferencingMediaSession }).mediaSession
    if (!ms || typeof ms.setActionHandler !== 'function') return

    const set = (action: string, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* unsupported action — ignore */
      }
    }

    set('togglemicrophone', () => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
    set('togglecamera', () => void localParticipant.setCameraEnabled(!isCameraEnabled))
    set('hangup', () => onLeave())
    try {
      ms.setMicrophoneActive?.(isMicrophoneEnabled)
      ms.setCameraActive?.(isCameraEnabled)
    } catch {
      /* state setters unsupported — buttons still work */
    }

    return () => {
      set('togglemicrophone', null)
      set('togglecamera', null)
      set('hangup', null)
    }
  }, [localParticipant, isMicrophoneEnabled, isCameraEnabled, onLeave])
}
