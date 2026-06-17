import { useEffect, useRef } from 'react'
import { useLocalParticipant, useConnectionQualityIndicator } from '@livekit/components-react'
import { Track, ConnectionQuality, type LocalVideoTrack } from 'livekit-client'
import { captureTiers } from '@/lib/livekit'

type TierName = 'full' | 'reduced' | 'floor'

// Hysteresis: drop quality quickly when the uplink hurts, restore slowly so a
// brief recovery blip doesn't trigger a restart storm (each restart freezes the
// preview for a beat). Asymmetric on purpose.
const DOWNGRADE_AFTER = 3000
const UPGRADE_AFTER = 8000
// Self-heal cadence: re-check that the applied tier matches what the connection
// wants, independent of ConnectionQuality emitting a change. This is what rescues
// a capture that got pinned low — a restart that failed mid-renegotiation (its
// error is swallowed) or a quality reading that went stale — instead of leaving
// it stuck until the user rejoins.
const RECONCILE_EVERY = 6000

/** Where each connection level wants the capture to sit. */
function tierFor(q: ConnectionQuality): TierName {
  switch (q) {
    case ConnectionQuality.Lost:
      return 'floor'
    case ConnectionQuality.Poor:
      return 'reduced'
    default:
      // Good / Excellent / Unknown → native quality.
      return 'full'
  }
}

const RANK: Record<TierName, number> = { floor: 0, reduced: 1, full: 2 }

/**
 * Network-driven level-of-detail for the *published* camera. The default capture
 * is the device's native quality (see roomOptions); this hook watches the local
 * participant's live ConnectionQuality and, only when the uplink is genuinely
 * struggling, restarts the camera at a lower resolution (LOD step-down). When the
 * connection recovers it climbs back to native. adaptiveStream/dynacast handle the
 * receive side.
 *
 * `appliedRef` tracks the resolution ACTUALLY applied — it's updated only after a
 * successful restart, never on intent. That's the fix for the old desync (and the
 * "poor on a good network until I rejoin" bug): a swallowed restart failure or a
 * camera that was off at decision time no longer leaves the state lying about the
 * live resolution, and the periodic reconcile retries until it truly converges.
 *
 * Disabled in low-bandwidth mode (the user already pinned the floor) and while the
 * camera is off. Owned by RoomView so it lives for the whole session.
 */
export function useAdaptiveQuality(lowBandwidth: boolean) {
  const { localParticipant } = useLocalParticipant()
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant })

  // Latest quality, read by the reconciler without re-subscribing it.
  const qualityRef = useRef(quality)
  qualityRef.current = quality

  // Current APPLIED tier (only set after a real restart), the tier a pending timer
  // is waiting to apply (so the periodic reconcile doesn't keep resetting the
  // dwell), and an in-flight guard so overlapping restarts can't race.
  const appliedRef = useRef<TierName>('full')
  const pendingTargetRef = useRef<TierName | null>(null)
  const restartingRef = useRef(false)
  const pendingTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (lowBandwidth) return
    let disposed = false

    const liveCamera = (): LocalVideoTrack | undefined => {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera)
      const track = pub?.track as LocalVideoTrack | undefined
      return track && !track.isMuted ? track : undefined
    }

    // Fire the actual capture restart for the current target. On success, record
    // the new applied tier; on failure (or no live camera right now) leave the
    // applied tier untouched so the next reconcile retries.
    const apply = async () => {
      pendingTimer.current = undefined
      pendingTargetRef.current = null
      const target = tierFor(qualityRef.current)
      if (disposed || target === appliedRef.current) return
      const track = liveCamera()
      if (!track || restartingRef.current) return
      restartingRef.current = true
      try {
        const next = captureTiers(lowBandwidth)[target]
        await track.restartTrack({ resolution: next.resolution })
        if (!disposed) appliedRef.current = target
      } catch {
        // Mid-renegotiation restart failure — leave the tier as-is; the periodic
        // reconcile will try again rather than leaving the capture pinned.
      } finally {
        restartingRef.current = false
      }
    }

    // Arm (or leave armed) a dwell timer toward the desired tier. Idempotent: if a
    // timer is already counting down toward the same target, it's left alone so
    // the reconcile tick can't starve an upgrade by perpetually resetting it.
    const reconcile = () => {
      if (disposed) return
      const target = tierFor(qualityRef.current)
      if (target === appliedRef.current) {
        window.clearTimeout(pendingTimer.current)
        pendingTimer.current = undefined
        pendingTargetRef.current = null
        return
      }
      if (pendingTargetRef.current === target && pendingTimer.current !== undefined) return
      window.clearTimeout(pendingTimer.current)
      const dwell = RANK[target] < RANK[appliedRef.current] ? DOWNGRADE_AFTER : UPGRADE_AFTER
      pendingTargetRef.current = target
      pendingTimer.current = window.setTimeout(() => void apply(), dwell)
    }

    reconcile()
    const interval = window.setInterval(reconcile, RECONCILE_EVERY)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.clearTimeout(pendingTimer.current)
      pendingTimer.current = undefined
      pendingTargetRef.current = null
    }
  }, [quality, lowBandwidth, localParticipant])
}
