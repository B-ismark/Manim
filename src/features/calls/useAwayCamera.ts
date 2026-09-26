import { useEffect, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { toggleDevice } from '@/lib/deviceToggle'
import { addBreadcrumb } from '@/lib/report'
import { useIsTouch } from '@/lib/useIsTouch'

/**
 * On a phone, your camera goes off while you're in another app and comes back
 * when you return. You stay in the call the whole time.
 *
 * A phone browser stops feeding the camera the moment the page is hidden, but
 * the track stays published, so everyone else was left looking at the last
 * frame: a frozen face that looks like the call has hung. Meet and Teams on a
 * phone do what this does. Turning the camera off properly means the others
 * see your name tile, which reads as "stepped away" instead of "broken".
 *
 * Only a camera that was ON when you left comes back. One you had off stays off.
 * If you change it yourself in between (the lock-screen controls, say), that
 * choice wins.
 *
 * Touch only: a laptop keeps capturing in a background tab, and hiding a tab to
 * look something up mid-call must not turn your camera off.
 *
 * useCameraInterruption still covers the other case: a camera the OS suspended
 * without the page ever being hidden long enough for this to act.
 */
export function useAwayCamera() {
  const touch = useIsTouch()
  const { localParticipant } = useLocalParticipant()
  // Did WE turn it off? Only then is it ours to turn back on.
  const pausedByUs = useRef(false)
  // Hide and return can come faster than a camera toggle finishes; run them in order.
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!touch) return
    const cameraOn = () => {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera)
      return !!pub?.track && !pub.isMuted
    }
    const then = (step: () => Promise<unknown>) => {
      chain.current = chain.current.then(step, step).catch(() => {})
      return chain.current
    }
    const onChange = (e: Event) => {
      if (e.type === 'pagehide' || document.visibilityState === 'hidden') {
        if (pausedByUs.current || !cameraOn()) return
        pausedByUs.current = true
        addBreadcrumb('camera off while the page is hidden')
        void then(() => localParticipant.setCameraEnabled(false))
        return
      }
      if (!pausedByUs.current) return
      pausedByUs.current = false
      void then(async () => {
        // Turned back on from somewhere else while we were away: nothing to do.
        if (cameraOn()) return
        addBreadcrumb('camera back on after returning')
        await new Promise<void>((resolve) =>
          toggleDevice('camera', true, () => localParticipant.setCameraEnabled(true).finally(resolve)),
        )
      })
    }
    document.addEventListener('visibilitychange', onChange)
    window.addEventListener('pagehide', onChange)
    window.addEventListener('pageshow', onChange)
    return () => {
      document.removeEventListener('visibilitychange', onChange)
      window.removeEventListener('pagehide', onChange)
      window.removeEventListener('pageshow', onChange)
    }
  }, [touch, localParticipant])
}
