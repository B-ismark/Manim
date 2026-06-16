import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalAudioTrack } from 'livekit-client'

type KrispModule = typeof import('@livekit/krisp-noise-filter')
type KrispProcessor = ReturnType<KrispModule['KrispNoiseFilter']>

/**
 * AI background-noise suppression via @livekit/krisp-noise-filter.
 *
 * The browser's own noiseSuppression (set in roomOptions audioCaptureDefaults) is
 * the always-on baseline. Krisp is the stronger, opt-in filter — it strips
 * keyboard, fans, background voices, etc. that the native filter leaves through.
 *
 * The model is a heavy WASM bundle, so it is **dynamically imported only when the
 * user first turns suppression on** — keeping the room bundle light (mirrors
 * useBackgroundBlur). Owned by RoomView so it persists across menu open/close.
 */
export function useNoiseFilter() {
  const { localParticipant } = useLocalParticipant()

  // Optimistic: show the control; verified against the module on first enable.
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const procRef = useRef<KrispProcessor | null>(null)
  const modRef = useRef<KrispModule | null>(null)

  const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
  const track = micPub?.track as LocalAudioTrack | undefined
  const trackSid = micPub?.trackSid

  useEffect(() => {
    let cancelled = false

    async function sync() {
      if (!enabled) {
        if (procRef.current) {
          try {
            await procRef.current.setEnabled(false)
          } catch {
            /* already off / detached */
          }
        }
        return
      }
      if (!track) return
      try {
        if (!modRef.current) modRef.current = await import('@livekit/krisp-noise-filter')
        const mod = modRef.current
        if (cancelled) return
        if (!mod.isKrispNoiseFilterSupported()) {
          setSupported(false)
          setEnabled(false)
          return
        }
        if (!procRef.current) procRef.current = mod.KrispNoiseFilter()
        // Attach to the current mic track (a no-op if already attached) and turn on.
        try {
          await track.setProcessor(procRef.current)
        } catch {
          /* already attached to this track */
        }
        if (cancelled) return
        await procRef.current.setEnabled(true)
      } catch {
        // Krisp couldn't load/init on this device (e.g. WASM/SharedArrayBuffer
        // unavailable). Don't silently revert a dead toggle — mark it
        // unsupported so the control honestly says so.
        if (!cancelled) {
          setSupported(false)
          setEnabled(false)
        }
      }
    }

    void sync()
    return () => {
      cancelled = true
    }
  }, [enabled, trackSid])

  const toggle = useCallback(() => setEnabled((v) => !v), [])

  return { supported, enabled, setEnabled, toggle }
}

export type NoiseFilterControls = ReturnType<typeof useNoiseFilter>
