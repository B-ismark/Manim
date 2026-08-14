/*
 * Network tier classification + hysteresis — the pure half of A1
 * (docs/low-bandwidth-plan.md §3 Tier A). No React, no LiveKit, no timers, so the
 * thresholds and the flap-damping can be tested directly.
 *
 * WHY NOT BITRATE. The obvious signal — "upload is low, therefore the network is
 * bad" — is wrong here, and measurably so. A user with their camera off sends only
 * ~73 kbps of audio on a perfectly good link (§2b), which any bitrate threshold
 * would score as dire. Throughput reflects what we chose to send at least as much
 * as what the link can carry. So the tier keys on properties of the WIRE that the
 * app does not control — round-trip time, packet loss, and the encoder's own
 * qualityLimitationReason — and bitrate is carried for reporting only.
 */

export type NetworkTier = 'offline' | 'dire' | 'weak' | 'good'

/** What is actually constraining the call, when anything is. */
export type Bottleneck = 'uplink' | 'downlink' | 'cpu' | 'none'

export interface NetSample {
  /** Round-trip time in ms, as reported by the remote peer. */
  rttMs?: number
  /** Outbound loss percentage (0–100) reported back by the remote. */
  uplinkLossPct?: number
  /** Inbound loss percentage (0–100) we observed locally. */
  downlinkLossPct?: number
  /** The encoder's own verdict: 'bandwidth' | 'cpu' | 'none' | 'other'. */
  limitedBy?: string
  /** Carried for reporting; deliberately NOT an input to the tier (see header). */
  upKbps?: number
  downKbps?: number
}

/**
 * Thresholds. Anchored to the measured profiles in §2b rather than invented:
 * `2g-congested` (≈900 ms RTT, 12 % loss) must land in `dire`, and the unshaped
 * control (sub-ms RTT, no loss, limitedBy 'none') must land in `good`.
 */
export const DIRE_RTT_MS = 700
export const DIRE_LOSS_PCT = 8
export const WEAK_RTT_MS = 300
export const WEAK_LOSS_PCT = 3

export function classify(sample: NetSample, online = true): NetworkTier {
  if (!online) return 'offline'

  const rtt = sample.rttMs ?? 0
  const loss = Math.max(sample.uplinkLossPct ?? 0, sample.downlinkLossPct ?? 0)

  if (rtt >= DIRE_RTT_MS || loss >= DIRE_LOSS_PCT) return 'dire'
  if (rtt >= WEAK_RTT_MS || loss >= WEAK_LOSS_PCT || sample.limitedBy === 'bandwidth') {
    return 'weak'
  }
  return 'good'
}

/** Which side hurts. 'cpu' is separated out because it is NOT a network problem and
 *  must not be reported as one — it means the device, not the link, is the limit. */
export function bottleneckOf(sample: NetSample): Bottleneck {
  if (sample.limitedBy === 'cpu') return 'cpu'
  const up = sample.uplinkLossPct ?? 0
  const down = sample.downlinkLossPct ?? 0
  if (sample.limitedBy === 'bandwidth') return up >= down ? 'uplink' : 'downlink'
  if (up >= WEAK_LOSS_PCT && up >= down) return 'uplink'
  if (down >= WEAK_LOSS_PCT) return 'downlink'
  return 'none'
}

/** Ordering for "is this a degradation or a recovery". */
const RANK: Record<NetworkTier, number> = { offline: 0, dire: 1, weak: 2, good: 3 }

/**
 * Sample counts before a change is believed. Asymmetric on purpose: react quickly
 * when things get worse (a user staring at a frozen tile should not wait 20s to be
 * told why), and slowly when they recover (so a single good sample in a bad patch
 * cannot flip the verdict back and forth). At the 2s sampling cadence these are
 * ~6s down and ~20s up.
 */
export const DEGRADE_SAMPLES = 3
export const RECOVER_SAMPLES = 10

export interface Settler {
  tier: NetworkTier
  /** The tier we are currently accumulating evidence for. */
  candidate: NetworkTier
  streak: number
}

export function initialSettler(tier: NetworkTier = 'good'): Settler {
  return { tier, candidate: tier, streak: 0 }
}

/**
 * Fold one classification into the settled verdict. Returns a NEW settler; the
 * caller decides whether `tier` changed and is therefore worth reporting.
 *
 * Offline is exempt from hysteresis in the degrading direction: `navigator.onLine`
 * going false is a fact, not an inference, and holding it for 6s would just be a
 * lie about the present. Recovery from offline still has to earn it.
 */
export function settle(state: Settler, next: NetworkTier): Settler {
  if (next === state.tier) return { tier: state.tier, candidate: next, streak: 0 }
  if (next === 'offline') return { tier: 'offline', candidate: 'offline', streak: 0 }

  const streak = next === state.candidate ? state.streak + 1 : 1
  const degrading = RANK[next] < RANK[state.tier]
  const needed = degrading ? DEGRADE_SAMPLES : RECOVER_SAMPLES
  if (streak >= needed) return { tier: next, candidate: next, streak: 0 }
  return { tier: state.tier, candidate: next, streak }
}
