import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalAudioTrack } from 'livekit-client'

type KrispModule = typeof import('@livekit/krisp-noise-filter')
type KrispProcessor = ReturnType<KrispModule['KrispNoiseFilter']>

/**
 * Background-noise suppression: a single on/off control that always engages the
 * best filter the device can run.
 *
 *  - **on**  → @livekit/krisp-noise-filter (AI) — strips keyboard, fans,
 *              background voices. If Krisp can't load/init on this device, we
 *              silently fall back to the browser's built-in WebRTC filter.
 *  - **off** → both disabled (browser constraint flipped off via applyConstraints).
 *
 * Krisp is a heavy WASM bundle, dynamically imported only when first turned on.
 * It's also **suspended while the mic is muted** so we only pay its CPU cost
 * while the user is actually transmitting. The expected weight when speaking is
 * an accepted tradeoff for the cleaner audio.
 *
 * Owned by RoomView so it persists across menu open/close.
 */
export function useNoiseFilter() {
  const { localParticipant } = useLocalParticipant()

  // Default on — matches the previous always-on browser baseline.
  const [enabled, setEnabled] = useState(true)
  // True once Krisp is the active engine (vs the browser-native fallback).
  const [usingKrisp, setUsingKrisp] = useState(false)
  const procRef = useRef<KrispProcessor | null>(null)
  const modRef = useRef<KrispModule | null>(null)
  // Krisp proven unavailable on this device — don't retry, stay on the fallback.
  const krispFailedRef = useRef(false)

  const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
  const track = micPub?.track as LocalAudioTrack | undefined
  const trackSid = micPub?.trackSid
  const muted = micPub?.isMuted ?? false

  // Browser-native noiseSuppression: the fallback filter, on when enabled but
  // **off once Krisp is carrying it** — stacking two suppressors over-processes
  // and muddies soft speech, so we let Krisp be the sole filter when active.
  // applyConstraints flips it live; Safari may reject it — degrade silently.
  useEffect(() => {
    const mst = track?.mediaStreamTrack
    if (!mst) return
    void mst.applyConstraints({ noiseSuppression: enabled && !usingKrisp }).catch(() => {})
  }, [enabled, usingKrisp, trackSid])

  // Krisp = the strongest filter. Engage it when enabled + mic live + supported;
  // suspend it while muted to reclaim CPU; fall back to the browser filter if it
  // can't load/init.
  useEffect(() => {
    let cancelled = false

    async function sync() {
      const wantKrisp = enabled && !muted && !krispFailedRef.current
      if (!wantKrisp) {
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
          // Browser-native filter (set above) carries it from here.
          krispFailedRef.current = true
          setUsingKrisp(false)
          return
        }
        if (!procRef.current) procRef.current = mod.KrispNoiseFilter()
        try {
          await track.setProcessor(procRef.current)
        } catch {
          /* already attached to this track */
        }
        if (cancelled) return
        await procRef.current.setEnabled(true)
        if (!cancelled) setUsingKrisp(true)
      } catch {
        // WASM/SharedArrayBuffer unavailable, etc. Fall back to the browser tier
        // rather than leaving suppression dead.
        if (!cancelled) {
          krispFailedRef.current = true
          setUsingKrisp(false)
        }
      }
    }

    void sync()
    return () => {
      cancelled = true
    }
  }, [enabled, muted, trackSid])

  const toggle = useCallback(() => setEnabled((v) => !v), [])

  return { enabled, setEnabled, toggle, usingKrisp }
}

export type NoiseFilterControls = ReturnType<typeof useNoiseFilter>
