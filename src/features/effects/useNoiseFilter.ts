import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalAudioTrack } from 'livekit-client'
import { reportError } from '@/lib/report'

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
  // Which mic track sid the processor is currently attached to — so a reconnect
  // that republishes the mic (new sid) rebuilds the filter instead of stranding
  // the new track behind a dead processor.
  const attachedSidRef = useRef<string | undefined>(undefined)
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
  // CRITICAL: applyConstraints REPLACES the whole constraint set, so we must
  // re-assert echoCancellation + autoGainControl here too. Passing only
  // noiseSuppression drops them back to device default (off) — which is what
  // turned every call into an "echo room".
  useEffect(() => {
    const mst = track?.mediaStreamTrack
    if (!mst) return
    void mst
      .applyConstraints({
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: enabled && !usingKrisp,
      })
      .catch(() => {})
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
      // A reconnect republished the mic under a new sid — the old processor is
      // bound to a dead track, so drop it and build a fresh one for the new track.
      if (procRef.current && attachedSidRef.current !== trackSid) {
        procRef.current = null
      }
      try {
        if (!modRef.current) modRef.current = await import('@livekit/krisp-noise-filter')
        const mod = modRef.current
        if (cancelled) return
        if (!mod.isKrispNoiseFilterSupported()) {
          // Browser-native filter (applyConstraints above) carries it from here.
          krispFailedRef.current = true
          setUsingKrisp(false)
          return
        }
        if (!procRef.current) procRef.current = mod.KrispNoiseFilter()
        // Attach only when not already on this track (re-setProcessor throws).
        if (attachedSidRef.current !== trackSid) {
          await track.setProcessor(procRef.current)
          attachedSidRef.current = trackSid
        }
        if (cancelled) return
        await procRef.current.setEnabled(true)
        if (!cancelled) setUsingKrisp(true)
      } catch (e) {
        // WASM/SharedArrayBuffer unavailable, or attach failed mid-reconnect.
        // CRITICAL: never leave the mic routed through a half-attached/stalled
        // processor — that's a silent mic. Strip it so raw audio passes through,
        // then fall back to the browser filter (usingKrisp:false re-enables the
        // native noiseSuppression constraint).
        try {
          await track.stopProcessor()
        } catch {
          /* nothing attached */
        }
        procRef.current = null
        attachedSidRef.current = undefined
        if (!cancelled) {
          krispFailedRef.current = true
          setUsingKrisp(false)
        }
        // The fallback keeps audio clean, but the user silently lost the AI filter
        // they enabled — report it (E2) so the Krisp-load failure rate is visible.
        reportError(e, { context: 'krisp-noise-filter' })
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
