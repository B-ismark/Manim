import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { isLowPowerDevice, isMobile } from '@/lib/device'

const DEFAULT_RADIUS = 12

/** What the camera processor is currently doing. */
export type EffectMode = 'none' | 'blur'

/**
 * Quality (blur only) — trades smoothness for power. The segmenter runs on the
 * GPU delegate either way; the real lever is the processor's frame cap:
 * - `standard` — segment at a modest rate (24fps desktop). Mobile is pinned here
 *   at 15fps, where full-rate per-frame segmentation otherwise tanks performance.
 * - `high` — segment at the full 30fps for smoother, lower-latency edges; heavier.
 */
export type BlurQuality = 'standard' | 'high'

type TrackProcessorsModule = typeof import('@livekit/track-processors')
type Processor = ReturnType<TrackProcessorsModule['BackgroundBlur']>

/**
 * Client-side background blur via @livekit/track-processors (MediaPipe, WebGL).
 * Image *replacement* (virtual backgrounds) was removed — the VirtualBackground
 * segmentation path repeatedly broke the live feed (frozen/garbled frames on
 * resegment), so we ship the one effect that's reliable: blur. The processor
 * module (~160 KB incl. MediaPipe) is dynamically imported only when blur is
 * first enabled, keeping the room bundle light. Blur radius updates live; the
 * processor is rebuilt only when the camera track or blur quality changes (the
 * segmenter delegate is fixed at construction). Owned by RoomView so it persists
 * across menu open/close.
 */
export function useBackgroundBlur() {
  const { localParticipant } = useLocalParticipant()

  // The GPU "high" delegate gives sharp, low-flicker edges but runs hot. Allow it
  // on any device that can take it (gate only the truly low-power ones), and
  // default to it so blur looks good out-of-the-box. Construction failure falls
  // back to standard.
  const allowHighQuality = !isLowPowerDevice()

  // Optimistic: show the controls; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  // True while the processor is (re)building — covers the first ~160KB MediaPipe
  // import so the preview can show a spinner instead of looking frozen.
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<EffectMode>('none')
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [quality, setQuality] = useState<BlurQuality>(() =>
    isLowPowerDevice() ? 'standard' : 'high',
  )

  const procRef = useRef<Processor | null>(null)
  const modRef = useRef<TrackProcessorsModule | null>(null)
  // Latest radius read by the rebuild effect without re-triggering it.
  const radiusRef = useRef(radius)
  radiusRef.current = radius

  const cameraPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const track = cameraPub?.track as LocalVideoTrack | undefined
  const trackSid = cameraPub?.trackSid

  useEffect(() => {
    let cancelled = false

    async function stopCurrent() {
      if (procRef.current && track) {
        try {
          await track.stopProcessor()
        } catch {
          /* already stopped */
        }
      }
      procRef.current = null
    }

    async function build(mod: TrackProcessorsModule) {
      // The segmenter runs on the GPU delegate by default in track-processors, so
      // the real perf lever is how OFTEN we segment, not which delegate. We cap
      // the processor's frame rate: the background is near-static, so segmenting
      // at a lower fps is visually imperceptible but roughly halves the per-frame
      // ML + WebGL cost — the fix for blur tanking mobile. The published camera
      // track keeps its full resolution/fps; only the mask refresh is throttled.
      const seg = quality === 'high' ? { delegate: 'GPU' as const } : undefined
      const maxFps = isMobile() ? 15 : quality === 'high' ? 30 : 24
      const proc = mod.BackgroundBlur(radiusRef.current, seg, undefined, { maxFps })
      await track!.setProcessor(proc)
      procRef.current = proc
    }

    async function sync() {
      if (mode === 'none') {
        await stopCurrent()
        if (!cancelled) setBusy(false)
        return
      }
      if (!track) return
      if (!cancelled) setBusy(true)
      try {
        if (!modRef.current) modRef.current = await import('@livekit/track-processors')
        const mod = modRef.current
        if (cancelled) return
        if (!mod.supportsBackgroundProcessors()) {
          setSupported(false)
          setMode('none')
          return
        }
        await stopCurrent()
        if (cancelled) return
        try {
          await build(mod)
        } catch {
          // GPU delegate (or this effect) failed → drop to standard blur so the
          // control degrades gracefully instead of leaving a broken processor.
          if (quality === 'high' && !cancelled) {
            setQuality('standard')
          } else {
            throw new Error('processor failed')
          }
        }
      } catch {
        if (!cancelled) setMode('none')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void sync()
    return () => {
      cancelled = true
    }
    // radius excluded — updated live below without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trackSid, quality])

  // Live blur-radius adjustment (no rebuild).
  useEffect(() => {
    if (mode !== 'blur' || !procRef.current) return
    void procRef.current.updateTransformerOptions({ blurRadius: radius }).catch(() => {})
  }, [radius, mode])

  const useNone = useCallback(() => setMode('none'), [])
  const useBlur = useCallback(() => setMode('blur'), [])

  // On mobile, never expose/allow the GPU-high path.
  const setQualityGated = useCallback(
    (q: BlurQuality) => setQuality(allowHighQuality ? q : 'standard'),
    [allowHighQuality],
  )

  return {
    supported,
    busy,
    allowHighQuality,
    mode,
    radius,
    setRadius,
    quality,
    setQuality: setQualityGated,
    useNone,
    useBlur,
  }
}

export type BackgroundBlurControls = ReturnType<typeof useBackgroundBlur>
