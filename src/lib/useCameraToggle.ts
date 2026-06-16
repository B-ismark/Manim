import { useCallback, useEffect, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'

/**
 * Camera on/off with a "warm, then release" strategy.
 *
 * LiveKit's `setCameraEnabled(false)` stops the underlying MediaStreamTrack to
 * turn the camera indicator off; re-enabling then pays a full getUserMedia
 * spin-up (~0.5–1.5s) — the lag behind "camera takes too long to activate".
 *
 * Instead, on OFF we **unpublish without stopping** the track (`stopOnUnpublish
 * = false`): the camera stays powered, remotes correctly see you as off, and a
 * re-enable within the warm window just re-publishes the *same* track —
 * instant, no getUserMedia. If you stay off past the window we stop the track
 * for real, so the indicator light goes out and privacy is preserved (the only
 * cost is the next enable re-acquires, which is the rare case).
 *
 * Flip-camera and the adaptive-quality LOD both operate on the *published*
 * camera track; while warm there is none, so they correctly no-op until it's
 * re-published.
 */
const WARM_WINDOW_MS = 15_000

export function useCameraToggle() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant()
  // The unpublished-but-still-live track held during the warm window.
  const warmRef = useRef<LocalVideoTrack | null>(null)
  const releaseTimer = useRef<number | undefined>(undefined)

  const releaseWarm = useCallback(() => {
    window.clearTimeout(releaseTimer.current)
    const t = warmRef.current
    warmRef.current = null
    if (t) {
      try {
        t.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  // Stop a held-warm camera if the component unmounts (e.g. leaving the call) so
  // we never leak a powered camera.
  useEffect(() => releaseWarm, [releaseWarm])

  const toggleCamera = useCallback(async () => {
    if (isCameraEnabled) {
      // Turn OFF — keep the track warm rather than stopping it.
      const pub = localParticipant.getTrackPublication(Track.Source.Camera)
      const track = pub?.track as LocalVideoTrack | undefined
      if (!track) {
        await localParticipant.setCameraEnabled(false)
        return
      }
      try {
        await localParticipant.unpublishTrack(track, false)
        warmRef.current = track
        window.clearTimeout(releaseTimer.current)
        releaseTimer.current = window.setTimeout(releaseWarm, WARM_WINDOW_MS)
      } catch {
        // Couldn't keep it warm — fall back to a clean stop so state stays sane.
        warmRef.current = null
        await localParticipant.setCameraEnabled(false)
      }
      return
    }

    // Turn ON — re-publish the warm track if we still have a live one.
    window.clearTimeout(releaseTimer.current)
    const warm = warmRef.current
    warmRef.current = null
    if (warm && warm.mediaStreamTrack.readyState === 'live') {
      try {
        await localParticipant.publishTrack(warm, { source: Track.Source.Camera })
        return
      } catch {
        // Re-publish failed (track went stale) — stop it and acquire fresh.
        try {
          warm.stop()
        } catch {
          /* ignore */
        }
      }
    }
    await localParticipant.setCameraEnabled(true)
  }, [isCameraEnabled, localParticipant, releaseWarm])

  return { isCameraEnabled, toggleCamera }
}
