import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { isLowPowerDevice } from '@/lib/device'

const DEFAULT_RADIUS = 12

/** What the camera processor is currently doing. */
export type EffectMode = 'none' | 'blur' | 'image'

/**
 * Edge quality (blur only):
 * - `standard` — MediaPipe segmentation on the default (CPU/auto) delegate.
 * - `high` — segmentation forced onto the **GPU** delegate: higher frame rate,
 *   less edge flicker, heavier on the GPU. Falls back to `standard` if the GPU
 *   delegate can't init, so it never breaks the call.
 */
export type BlurQuality = 'standard' | 'high'

export interface BackgroundPreset {
  id: string
  label: string
  /** Data URL of the background image fed to VirtualBackground. */
  src: string
}

type TrackProcessorsModule = typeof import('@livekit/track-processors')
type Processor = ReturnType<TrackProcessorsModule['BackgroundBlur']>

/**
 * Build a gradient as an SVG data URL. Deliberately NOT canvas.toDataURL — that
 * readback is blocked/farbled by anti-fingerprinting browsers (Brave), which
 * left the preset thumbnails blank and the background unset. An SVG data URL
 * renders reliably both as a CSS thumbnail and as the VirtualBackground source.
 */
function gradientDataUrl(stops: Array<[number, string]>, diagonal = true): string {
  const x2 = diagonal ? 1 : 0
  const stopsSvg = stops
    .map(([offset, color]) => `<stop offset="${offset * 100}%" stop-color="${color}"/>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="1">${stopsSvg}</linearGradient></defs>` +
    `<rect width="640" height="360" fill="url(#g)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

let cachedPresets: BackgroundPreset[] | null = null
function buildPresets(): BackgroundPreset[] {
  if (cachedPresets) return cachedPresets
  if (typeof document === 'undefined') return []
  cachedPresets = [
    { id: 'slate', label: 'Slate', src: gradientDataUrl([[0, '#1f2933'], [1, '#3e4c59']]) },
    { id: 'dusk', label: 'Dusk', src: gradientDataUrl([[0, '#4c1d95'], [1, '#1e3a8a']]) },
    { id: 'warm', label: 'Warm', src: gradientDataUrl([[0, '#f59e0b'], [1, '#b45309']]) },
    { id: 'mint', label: 'Mint', src: gradientDataUrl([[0, '#0f766e'], [1, '#134e4a']]) },
  ]
  return cachedPresets
}

/**
 * Client-side background effects via @livekit/track-processors (MediaPipe, WebGL):
 * blur or a replacement image. The processor module (~160 KB incl. MediaPipe) is
 * **dynamically imported only when an effect is first enabled**, keeping the room
 * bundle light. Blur radius and the chosen image update live; the processor is
 * rebuilt only when the mode, camera track, or blur quality changes (the
 * segmenter delegate is fixed at construction). Owned by RoomView so it persists
 * across menu open/close.
 */
export function useBackgroundBlur() {
  const { localParticipant } = useLocalParticipant()

  // The GPU "high" delegate gives sharp, low-flicker edges but runs hot. Now that
  // the camera captures at 720p+ on phones, the standard (CPU/auto) delegate
  // segmenting that larger frame is where the "terrible blur" came from — soft,
  // crawling edges. Allow GPU on any device that can take it (gate only the truly
  // low-power ones: ≤4 cores / ≤4GB), and default to it so blur looks good
  // out-of-the-box. Construction failure still falls back to standard.
  const allowHighQuality = !isLowPowerDevice()

  // Optimistic: show the controls; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  // True while the processor is (re)building — covers the first ~160KB MediaPipe
  // import so the preview can show a spinner instead of looking frozen.
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<EffectMode>('none')
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  // Default to the GPU delegate where the device can take it — that's the
  // difference between crisp and crawling edges. Falls back to standard on init
  // failure (see build()) or on low-power devices (setQualityGated pins it).
  const [quality, setQuality] = useState<BlurQuality>(() =>
    isLowPowerDevice() ? 'standard' : 'high',
  )
  const [imageSrc, setImageSrc] = useState<string>('')
  const [customImage, setCustomImage] = useState<string | null>(null)
  const [presets] = useState<BackgroundPreset[]>(() => buildPresets())

  const procRef = useRef<Processor | null>(null)
  const modRef = useRef<TrackProcessorsModule | null>(null)
  // Latest selection read by the rebuild effect without re-triggering it.
  const radiusRef = useRef(radius)
  const imageRef = useRef(imageSrc)
  radiusRef.current = radius
  imageRef.current = imageSrc

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
      const seg = quality === 'high' ? { delegate: 'GPU' as const } : undefined
      const proc =
        mode === 'image'
          ? mod.VirtualBackground(imageRef.current, seg)
          : mod.BackgroundBlur(radiusRef.current, seg)
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
    // radius/imageSrc excluded — updated live below without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trackSid, quality])

  // Live blur-radius adjustment (no rebuild).
  useEffect(() => {
    if (mode !== 'blur' || !procRef.current) return
    void procRef.current.updateTransformerOptions({ blurRadius: radius }).catch(() => {})
  }, [radius, mode])

  // Live background-image swap (no rebuild).
  useEffect(() => {
    if (mode !== 'image' || !procRef.current || !imageSrc) return
    void procRef.current.updateTransformerOptions({ imagePath: imageSrc }).catch(() => {})
  }, [imageSrc, mode])

  const useNone = useCallback(() => setMode('none'), [])
  const useBlur = useCallback(() => setMode('blur'), [])

  const selectImage = useCallback((src: string) => {
    setImageSrc(src)
    setMode('image')
  }, [])

  const addCustomImage = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file)
      setCustomImage((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setImageSrc(url)
      setMode('image')
    },
    [],
  )

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
    selectedImage: imageSrc,
    presets,
    customImage,
    useNone,
    useBlur,
    selectImage,
    addCustomImage,
  }
}

export type BackgroundBlurControls = ReturnType<typeof useBackgroundBlur>
