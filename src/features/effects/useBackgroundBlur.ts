import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { isLowPowerDevice, isMobile } from '@/lib/device'
import { reportError } from '@/lib/report'

const DEFAULT_RADIUS = 12

/** Camera frame rate while blur runs. See `capFrameRate` for why it's the camera. */
export function blurFrameRate(quality: BlurQuality, mobile: boolean): number | null {
  if (mobile) return 15
  return quality === 'high' ? null : 24
}

/**
 * Cap the CAMERA's frame rate, and return how to undo it.
 *
 * track-processors' own `maxFps` reads like the lever and isn't one where it
 * matters: it only throttles the canvas.captureStream FALLBACK (Safari, Firefox).
 * On Chromium — every Android phone and most desktops — the processor pulls frames
 * through MediaStreamTrackProcessor and segments EVERY frame the camera delivers,
 * synchronously, on the main thread. So the only way to segment fewer frames there
 * is to be handed fewer: ask the camera for them.
 *
 * `applyConstraints` REPLACES the whole constraint set, so the current one is
 * carried over and only `frameRate` changes — passing `{ frameRate }` alone would
 * also drop the 720p width/height and let the camera fall back to its default mode.
 */
async function capFrameRate(mst: MediaStreamTrack, max: number): Promise<() => Promise<void>> {
  const before = mst.getConstraints()
  await mst.applyConstraints({ ...before, frameRate: { max } })
  return async () => {
    if (mst.readyState !== 'live') return
    await mst.applyConstraints(before)
  }
}

/** What the camera processor is currently doing. */
export type EffectMode = 'none' | 'blur'

// Effect choice is remembered across joins (Meet/Zoom convention) — re-enabling
// blur every single call was the most-felt instance of the persistence gap. We
// persist the bare choice (mode/radius/quality) and re-apply it on the next join;
// low-power gating still wins at read time, so a saved 'high' never overrides it.
//
// Except on a PHONE, where blur is never switched back on by itself. It is the
// heaviest thing a phone can run in a call (a segmenter per frame on top of the
// encoder), and one that silently came back on every join was costing people a
// smooth call they never asked to trade. Radius and quality are still remembered,
// so turning it back on is one tap to exactly what they had.
const STORE_KEY = 'mn.effects'
type PersistedEffect = { mode: EffectMode; radius: number; quality: BlurQuality }

function loadEffect(): Partial<PersistedEffect> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const v = JSON.parse(raw) as Partial<PersistedEffect>
    return {
      mode: v.mode === 'blur' ? 'blur' : 'none',
      radius: typeof v.radius === 'number' ? Math.min(25, Math.max(1, Math.round(v.radius))) : undefined,
      quality: v.quality === 'high' ? 'high' : v.quality === 'standard' ? 'standard' : undefined,
    }
  } catch {
    return {}
  }
}

function saveEffect(v: PersistedEffect) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    /* private mode / quota — non-fatal, the session just won't be remembered */
  }
}

/**
 * Quality (blur only) — trades smoothness for power. The segmenter runs on the
 * GPU delegate either way; the real lever is how many frames it has to segment:
 * - `standard` — 24fps on desktop. Phones are pinned at 15fps whatever is chosen,
 *   where full-rate per-frame segmentation otherwise tanks performance.
 * - `high` — the camera's full 30fps for smoother edges; heavier.
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

  // Last session's choice, re-applied on join (low-power gating wins below).
  // Lazy init so localStorage is read once at mount, not on every render.
  const [saved] = useState(loadEffect)

  // Optimistic: show the controls; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  // True while the processor is (re)building — covers the first ~160KB MediaPipe
  // import so the preview can show a spinner instead of looking frozen.
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<EffectMode>(isMobile() ? 'none' : (saved.mode ?? 'none'))
  const [radius, setRadius] = useState(saved.radius ?? DEFAULT_RADIUS)
  const [quality, setQuality] = useState<BlurQuality>(() =>
    isLowPowerDevice() ? 'standard' : (saved.quality ?? 'standard'),
  )

  // Remember the choice for the next join. Cheap enough to write on every change.
  useEffect(() => {
    saveEffect({ mode, radius, quality })
  }, [mode, radius, quality])

  const procRef = useRef<Processor | null>(null)
  // Undoes the camera frame-rate cap blur put on (null when none is in force).
  const uncapRef = useRef<(() => Promise<void>) | null>(null)
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
      const uncap = uncapRef.current
      uncapRef.current = null
      await uncap?.().catch(() => {})
    }

    async function build(mod: TrackProcessorsModule) {
      // The segmenter runs on the GPU delegate by default in track-processors, so
      // the real perf lever is how OFTEN we segment, not which delegate. Fewer
      // frames in means fewer segmenter passes blocking the main thread; at 15-24fps
      // a talking head still reads as smooth. The cap goes on BEFORE the processor
      // takes the track, while `mediaStreamTrack` is still the camera itself.
      const seg = quality === 'high' ? { delegate: 'GPU' as const } : undefined
      const fps = blurFrameRate(quality, isMobile())
      if (fps) {
        try {
          uncapRef.current = await capFrameRate(track!.mediaStreamTrack, fps)
        } catch {
          /* a camera that refuses the constraint just keeps its rate */
        }
      }
      // maxFps still matters on the fallback path (Safari/Firefox), which ignores
      // the camera's rate and samples on its own clock.
      const proc = mod.BackgroundBlur(radiusRef.current, seg, undefined, { maxFps: fps ?? 30 })
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
      } catch (e) {
        // Module import or processor construction failed for real — the user loses
        // blur with no idea why. Degrade to 'none', and report it (E2) so a device
        // class that can never build the processor is visible, not silent.
        if (!cancelled) setMode('none')
        reportError(e, { context: 'blur-processor', quality })
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

  // Memoized because this object is now a CONTEXT value (see BlurContext): the
  // self-view tile reads it through a provider, and a fresh object every render
  // would make every consumer re-render whenever RoomView does. Harmless today —
  // `<Stage />` isn't memoized, so those renders already happen — but a context
  // value that changes identity on every render quietly disarms any memo boundary
  // someone adds later, which is a trap worth not laying. Every callback in here
  // is already stable (useCallback / setState).
  return useMemo(
    () => ({
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
    }),
    [supported, busy, allowHighQuality, mode, radius, quality, setQualityGated, useNone, useBlur],
  )
}

export type BackgroundBlurControls = ReturnType<typeof useBackgroundBlur>
