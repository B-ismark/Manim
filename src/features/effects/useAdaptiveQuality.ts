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
 * connection recovers it climbs back to native. This is the "scale down on a bad
 * network" half — adaptiveStream/dynacast already handle the receive side.
 *
 * Disabled in low-bandwidth mode (the user already pinned the floor) and while the
 * camera is off. Owned by RoomView so it lives for the whole session.
 */
export function useAdaptiveQuality(lowBandwidth: boolean) {
  const { localParticipant } = useLocalParticipant()
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant })

  // Current applied tier + an in-flight guard so overlapping restarts can't race.
  const appliedRef = useRef<TierName>('full')
  const restartingRef = useRef(false)
  const pendingTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (lowBandwidth) return
    const target = tierFor(quality)
    const applied = appliedRef.current
    if (target === applied) {
      window.clearTimeout(pendingTimer.current)
      return
    }

    const dwell = RANK[target] < RANK[applied] ? DOWNGRADE_AFTER : UPGRADE_AFTER

    window.clearTimeout(pendingTimer.current)
    pendingTimer.current = window.setTimeout(async () => {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera)
      const track = pub?.track as LocalVideoTrack | undefined
      // No live camera (off / placeholder) → record intent so we don't thrash,
      // but nothing to restart right now.
      if (!track || track.isMuted) {
        appliedRef.current = target
        return
      }
      if (restartingRef.current) return
      restartingRef.current = true
      try {
        const tiers = captureTiers(lowBandwidth)
        const next = tiers[target]
        await track.restartTrack({ resolution: next.resolution })
        appliedRef.current = target
      } catch {
        // Restart can fail mid-renegotiation; leave the tier as-is and let the
        // next quality tick retry.
      } finally {
        restartingRef.current = false
      }
    }, dwell)

    return () => window.clearTimeout(pendingTimer.current)
  }, [quality, lowBandwidth, localParticipant])
}
