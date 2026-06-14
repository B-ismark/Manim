import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'

const DEFAULT_RADIUS = 12

type TrackProcessorsModule = typeof import('@livekit/track-processors')
type BlurProcessor = ReturnType<TrackProcessorsModule['BackgroundBlur']>

/**
 * Client-side background blur via @livekit/track-processors (MediaPipe, GPU).
 *
 * The processor module (~160 KB incl. MediaPipe) is **dynamically imported only
 * when blur is first enabled**, keeping the room bundle light (STYLE.md /
 * Architecture "lightweight"). Radius adjusts live; re-applies when the camera
 * track changes. Owned by RoomView so it persists across menu open/close.
 */
export function useBackgroundBlur() {
  const { localParticipant } = useLocalParticipant()

  // Optimistic: show the control; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const procRef = useRef<BlurProcessor | null>(null)
  const modRef = useRef<TrackProcessorsModule | null>(null)

  const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const track = cameraPub?.track as LocalVideoTrack | undefined
  const trackSid = cameraPub?.trackSid

  useEffect(() => {
    let cancelled = false

    async function sync() {
      if (enabled) {
        if (!track) return
        try {
          if (!modRef.current) modRef.current = await import('@livekit/track-processors')
          if (cancelled) return
          if (!modRef.current.supportsBackgroundProcessors()) {
            setSupported(false)
            setEnabled(false)
            return
          }
          const proc = modRef.current.BackgroundBlur(radius)
          procRef.current = proc
          await track.setProcessor(proc)
        } catch {
          setEnabled(false)
        }
      } else if (procRef.current && track) {
        try {
          await track.stopProcessor()
        } catch {
          /* already stopped */
        }
        procRef.current = null
      }
    }

    void sync()
    return () => {
      cancelled = true
    }
    // radius excluded — adjusted live below without rebuilding the processor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trackSid])

  useEffect(() => {
    if (!enabled || !procRef.current) return
    void procRef.current.updateTransformerOptions({ blurRadius: radius }).catch(() => {})
  }, [radius, enabled])

  const toggle = useCallback(() => setEnabled((v) => !v), [])

  return { supported, enabled, setEnabled, toggle, radius, setRadius }
}

export type BackgroundBlurControls = ReturnType<typeof useBackgroundBlur>
