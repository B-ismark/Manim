import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { isMobile } from '@/lib/device'

const DEFAULT_RADIUS = 12

/**
 * Edge quality:
 * - `standard` — MediaPipe segmentation on the default (CPU/auto) delegate.
 *   Lightest; the safe baseline.
 * - `high` — segmentation forced onto the **GPU** delegate. Runs at a higher
 *   frame rate, so the person/background mask updates more often and the edge
 *   flickers far less. Heavier on the GPU; falls back to `standard` if the
 *   browser can't init the GPU delegate, so it never breaks the call.
 */
export type BlurQuality = 'standard' | 'high'

type TrackProcessorsModule = typeof import('@livekit/track-processors')
type BlurProcessor = ReturnType<TrackProcessorsModule['BackgroundBlur']>

/**
 * Client-side background blur via @livekit/track-processors (MediaPipe, WebGL).
 *
 * The processor module (~160 KB incl. MediaPipe) is **dynamically imported only
 * when blur is first enabled**, keeping the room bundle light (STYLE.md /
 * Architecture "lightweight"). Radius adjusts live; the processor is rebuilt
 * when the camera track or quality changes (segmenterOptions can't update live).
 * Owned by RoomView so it persists across menu open/close.
 */
export function useBackgroundBlur() {
  const { localParticipant } = useLocalParticipant()

  // The GPU "high" delegate runs hot — fine on a plugged-in desktop, but on phones
  // it spikes battery/thermals (and the camera is already capped to 360p, so the
  // edge gain is marginal). Hide it on mobile and pin quality to standard there.
  const allowHighQuality = !isMobile()

  // Optimistic: show the control; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [quality, setQuality] = useState<BlurQuality>('standard')
  const procRef = useRef<BlurProcessor | null>(null)
  const modRef = useRef<TrackProcessorsModule | null>(null)

  const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const track = cameraPub?.track as LocalVideoTrack | undefined
  const trackSid = cameraPub?.trackSid

  useEffect(() => {
    let cancelled = false

    async function apply(mod: TrackProcessorsModule, useGpu: boolean) {
      const seg = useGpu ? { delegate: 'GPU' as const } : undefined
      const proc = mod.BackgroundBlur(radius, seg)
      await track!.setProcessor(proc)
      procRef.current = proc
    }

    async function sync() {
      if (enabled) {
        if (!track) return
        try {
          if (!modRef.current) modRef.current = await import('@livekit/track-processors')
          const mod = modRef.current
          if (cancelled) return
          if (!mod.supportsBackgroundProcessors()) {
            setSupported(false)
            setEnabled(false)
            return
          }
          // Rebuild from scratch — segmenter delegate is fixed at construction.
          if (procRef.current) {
            try {
              await track.stopProcessor()
            } catch {
              /* already stopped */
            }
            procRef.current = null
          }
          if (cancelled) return
          try {
            await apply(mod, quality === 'high')
          } catch {
            // GPU delegate unsupported on this device → drop to standard so the
            // toggle degrades gracefully instead of disabling blur entirely.
            if (quality === 'high' && !cancelled) {
              setQuality('standard')
              await apply(mod, false)
            } else {
              throw new Error('processor failed')
            }
          }
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
  }, [enabled, trackSid, quality])

  useEffect(() => {
    if (!enabled || !procRef.current) return
    void procRef.current.updateTransformerOptions({ blurRadius: radius }).catch(() => {})
  }, [radius, enabled])

  const toggle = useCallback(() => setEnabled((v) => !v), [])

  // On mobile, never expose/allow the GPU-high path.
  const setQualityGated = useCallback(
    (q: BlurQuality) => setQuality(allowHighQuality ? q : 'standard'),
    [allowHighQuality],
  )

  return {
    supported,
    enabled,
    setEnabled,
    toggle,
    radius,
    setRadius,
    quality,
    setQuality: setQualityGated,
    allowHighQuality,
  }
}

export type BackgroundBlurControls = ReturnType<typeof useBackgroundBlur>
