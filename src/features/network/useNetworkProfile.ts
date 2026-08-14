import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import {
  ConnectionQuality,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteAudioTrack,
  type RemoteVideoTrack,
  type Room,
} from 'livekit-client'
import {
  bottleneckOf,
  classify,
  initialSettler,
  settle,
  type Bottleneck,
  type NetSample,
  type NetworkTier,
} from '@/lib/network/classify'
import { addBreadcrumb } from '@/lib/report'

/**
 * A1 — the network sensing hook (docs/low-bandwidth-plan.md §3 Tier A).
 *
 * **MEASUREMENT ONLY, on purpose.** It changes no behaviour and renders nothing.
 * The plan calls A1 "both the first dependency and the measuring instrument": every
 * proposal in Tiers B/C/F is gated on knowing whether real users are actually on bad
 * networks and which direction hurts (R-a…R-d), and nothing in the app has ever
 * measured that. Shipping the instrument inert is how that question gets answered
 * without betting any UX on the answer first.
 *
 * Three inputs, fused:
 *  1. `navigator.connection` — the only signal available BEFORE a call connects, so
 *     it is what a prejoin default would key on. Chromium-only (Safari and Firefox
 *     do not ship it), which is exactly why it is recorded as a hint and never
 *     allowed to decide anything on its own.
 *  2. LiveKit's `ConnectionQuality` — already computed for us, already debounced in
 *     the UI, but until now consumed only decoratively.
 *  3. `getStats()` via LiveKit's PUBLIC per-track accessors (`getSenderStats` /
 *     `getReceiverStats`) — the only source that says which DIRECTION is bad. No
 *     engine internals are touched, so this cannot break on a minor SDK bump.
 *
 * Sampling discipline mirrors `AnnotationEngine`: raw samples never reach React
 * state. They land in a ref-held ring buffer; only the coarse settled verdict is
 * published, and only when it actually changes.
 *
 * Reporting is deliberately sparse. `report.ts` keeps a 30-entry breadcrumb ring
 * shared with connection-state transitions, join attempts and device changes — a
 * sample every 2s would evict all of that within a minute and make error reports
 * *worse*. So: one breadcrumb per settled tier change, plus one summary when the
 * call ends.
 */

/** Matches LiveKit's own `monitorFrequency`, so we sample in step with its stats. */
const SAMPLE_MS = 2000
/** ~2 minutes of history at the sampling cadence. */
const RING = 60

interface ConnectionHint {
  effectiveType?: string
  downlinkMbps?: number
  rttMs?: number
  saveData?: boolean
}

export interface NetworkProfile {
  tier: NetworkTier
  bottleneck: Bottleneck
  /** Chromium-only, absent elsewhere. A hint, never the basis — see the header. */
  hint?: ConnectionHint
}

function readHint(): ConnectionHint | undefined {
  const c = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
    }
  ).connection
  if (!c) return undefined
  return {
    effectiveType: c.effectiveType,
    downlinkMbps: c.downlink,
    rttMs: c.rtt,
    saveData: c.saveData,
  }
}

const pct = (lost?: number, total?: number) =>
  total && total > 0 ? Math.min(100, Math.max(0, ((lost ?? 0) / total) * 100)) : 0

/** One pass over the room's public per-track stats. Never throws: a track can end
 *  mid-await, and a failed sample must degrade to "no reading", not to an error. */
async function sampleRoom(room: Room, prevBytes: { up: number; down: number }): Promise<{
  sample: NetSample
  bytes: { up: number; down: number }
}> {
  let rttMs: number | undefined
  let upLost = 0
  let upTotal = 0
  let downLost = 0
  let downTotal = 0
  let upBytes = 0
  let downBytes = 0
  let limitedBy: string | undefined

  try {
    const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as
      | LocalAudioTrack
      | undefined
    const cam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      | LocalVideoTrack
      | undefined

    if (mic) {
      const s = await mic.getSenderStats()
      if (s) {
        rttMs = s.roundTripTime !== undefined ? s.roundTripTime * 1000 : rttMs
        upLost += s.packetsLost ?? 0
        upTotal += (s.packetsSent ?? 0) + (s.packetsLost ?? 0)
        upBytes += s.bytesSent ?? 0
      }
    }
    if (cam) {
      // One entry per simulcast layer; sum them for the real uplink cost.
      for (const s of await cam.getSenderStats()) {
        rttMs = s.roundTripTime !== undefined ? s.roundTripTime * 1000 : rttMs
        upLost += s.packetsLost ?? 0
        upTotal += (s.packetsSent ?? 0) + (s.packetsLost ?? 0)
        upBytes += s.bytesSent ?? 0
        // Any layer reporting a constraint constrains the publication.
        if (s.qualityLimitationReason && s.qualityLimitationReason !== 'none') {
          limitedBy = s.qualityLimitationReason
        }
      }
    }

    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        const t = pub.track as RemoteAudioTrack | RemoteVideoTrack | undefined
        if (!t || typeof t.getReceiverStats !== 'function') continue
        const s = await t.getReceiverStats()
        if (!s) continue
        downLost += s.packetsLost ?? 0
        downTotal += (s.packetsReceived ?? 0) + (s.packetsLost ?? 0)
        downBytes += s.bytesReceived ?? 0
      }
    }
  } catch {
    /* a track ended mid-sample — return whatever we gathered */
  }

  const dtSec = SAMPLE_MS / 1000
  return {
    sample: {
      rttMs,
      uplinkLossPct: pct(upLost, upTotal),
      downlinkLossPct: pct(downLost, downTotal),
      limitedBy: limitedBy ?? 'none',
      upKbps: Math.max(0, Math.round(((upBytes - prevBytes.up) * 8) / 1000 / dtSec)),
      downKbps: Math.max(0, Math.round(((downBytes - prevBytes.down) * 8) / 1000 / dtSec)),
    },
    bytes: { up: upBytes, down: downBytes },
  }
}

export function useNetworkProfile(): NetworkProfile {
  const room = useRoomContext()
  const [profile, setProfile] = useState<NetworkProfile>({ tier: 'good', bottleneck: 'none' })

  // Everything below the published verdict stays in refs — see the header.
  const ring = useRef<NetSample[]>([])
  const settler = useRef(initialSettler('good'))
  const bytes = useRef({ up: 0, down: 0 })
  const worst = useRef<NetworkTier>('good')
  const changes = useRef(0)

  useEffect(() => {
    let stopped = false

    const tick = async () => {
      if (stopped) return
      const { sample, bytes: next } = await sampleRoom(room, bytes.current)
      if (stopped) return
      bytes.current = next

      ring.current.push(sample)
      if (ring.current.length > RING) ring.current.shift()

      // LiveKit's own score is a second opinion: it can see trouble in the transport
      // that per-track counters miss (and vice versa), so take the pessimistic view.
      const q = room.localParticipant.connectionQuality
      const lkTier: NetworkTier =
        q === ConnectionQuality.Lost ? 'dire' : q === ConnectionQuality.Poor ? 'weak' : 'good'
      const online = typeof navigator === 'undefined' || navigator.onLine
      const own = classify(sample, online)
      const candidate: NetworkTier =
        !online ? 'offline' : own === 'dire' || lkTier === 'dire' ? 'dire'
        : own === 'weak' || lkTier === 'weak' ? 'weak'
        : 'good'

      const before = settler.current.tier
      settler.current = settle(settler.current, candidate)
      const after = settler.current.tier
      if (after !== before) {
        changes.current += 1
        if (after !== 'good' && after !== 'offline') worst.current = after
        if (after === 'dire') worst.current = 'dire'
        const bottleneck = bottleneckOf(sample)
        addBreadcrumb('network tier', {
          from: before,
          to: after,
          bottleneck,
          rttMs: sample.rttMs !== undefined ? Math.round(sample.rttMs) : undefined,
          upLossPct: Math.round(sample.uplinkLossPct ?? 0),
          downLossPct: Math.round(sample.downlinkLossPct ?? 0),
          upKbps: sample.upKbps,
          downKbps: sample.downKbps,
          limitedBy: sample.limitedBy,
          hint: readHint(),
        })
        setProfile({ tier: after, bottleneck, hint: readHint() })
      }
    }

    const id = window.setInterval(() => void tick(), SAMPLE_MS)
    void tick()

    return () => {
      stopped = true
      window.clearInterval(id)
      // One summary per call — this is the row that answers R-a…R-d in aggregate,
      // and it is worth exactly one breadcrumb.
      const samples = ring.current
      if (samples.length) {
        const avg = (f: (s: NetSample) => number | undefined) =>
          Math.round(samples.reduce((a, s) => a + (f(s) ?? 0), 0) / samples.length)
        addBreadcrumb('network summary', {
          samples: samples.length,
          tierChanges: changes.current,
          worstTier: worst.current,
          avgRttMs: avg((s) => s.rttMs),
          avgUpLossPct: avg((s) => s.uplinkLossPct),
          avgDownLossPct: avg((s) => s.downlinkLossPct),
          avgUpKbps: avg((s) => s.upKbps),
          avgDownKbps: avg((s) => s.downKbps),
          bandwidthLimitedSamples: samples.filter((s) => s.limitedBy === 'bandwidth').length,
          cpuLimitedSamples: samples.filter((s) => s.limitedBy === 'cpu').length,
          hint: readHint(),
        })
      }
    }
  }, [room])

  return profile
}
