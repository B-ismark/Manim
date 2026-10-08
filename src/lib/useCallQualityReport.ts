import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import {
  ConnectionState,
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  Track,
  type Room,
} from 'livekit-client'
import { edgeRegion, summarise, type QualitySample } from '@/lib/callQuality'
import { countUsage, surface } from '@/lib/usage'

/** One sample every 10s — getStats on a handful of tracks, cheap at that rate. */
const SAMPLE_MS = 10_000

type Counters = { at: number; frames?: number; received?: number; lost?: number }

/**
 * Collects lib/callQuality samples for the whole call and sends ONE anonymous
 * summary when you leave (unmount or the page closing, whichever comes first).
 *
 * Production only, like every usage count (countUsage is a no-op elsewhere), so it
 * costs nothing in dev and never reaches a test run. The sampling itself still runs
 * in dev: it's read-only and cheap, and a dev build exercising it is how a
 * regression in it would show up.
 */
export function useCallQualityReport(): void {
  const room = useRoomContext()

  useEffect(() => {
    const samples: QualitySample[] = []
    const prev = new Map<string, Counters>()
    let sent = false
    let busy = false

    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const s = await sample(room, prev)
        if (s) samples.push(s)
      } catch {
        /* a stats hiccup costs one sample, never the call */
      } finally {
        busy = false
      }
    }

    const send = () => {
      if (sent) return
      sent = true
      const q = summarise(samples)
      if (!q) return
      const edge = edgeRegion(room.serverInfo?.region)
      const where = surface()
      if (q.rtt) countUsage('call_rtt', q.rtt, edge)
      if (q.loss) countUsage('call_loss', q.loss, edge)
      if (q.fps) countUsage('call_fps', q.fps, where)
      if (q.limit) countUsage('call_limit', q.limit, where)
    }

    const timer = setInterval(() => void tick(), SAMPLE_MS)
    window.addEventListener('pagehide', send)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', send)
      send()
    }
  }, [room])
}

async function sample(room: Room, prev: Map<string, Counters>): Promise<QualitySample | null> {
  if (room.state !== ConnectionState.Connected) return null
  const now = performance.now()
  const out: QualitySample = { received: 0, lost: 0 }

  // Your side: the camera's limit and the edge round trip (from the camera, or the
  // mic when the camera is off — both carry the remote's RTCP round-trip time).
  const lp = room.localParticipant
  const cam = lp.getTrackPublication(Track.Source.Camera)
  const mic = lp.getTrackPublication(Track.Source.Microphone)
  if (cam?.track instanceof LocalVideoTrack && !cam.isMuted) {
    const layers = await cam.track.getSenderStats()
    const top = layers.find((l) => l.qualityLimitationReason !== undefined)
    if (top) out.limit = top.qualityLimitationReason
    const rtt = layers.find((l) => l.roundTripTime !== undefined)?.roundTripTime
    if (rtt !== undefined) out.rttMs = rtt * 1000
  }
  if (out.rttMs === undefined && mic?.track instanceof LocalAudioTrack && !mic.isMuted) {
    const rtt = (await mic.track.getSenderStats())?.roundTripTime
    if (rtt !== undefined) out.rttMs = rtt * 1000
  }

  // Their side: loss across everything you receive, and the frame rate of the
  // videos that SHOULD be flowing. A tile that's off-screen or paused by
  // adaptiveStream (`isEnabled` false) or muted decodes nothing by design and is
  // left out; any other video that decoded nothing is a frozen feed — the very lag
  // this measures — and counts as 0fps.
  const fps: number[] = []
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) {
      const t = pub.track
      if (!(t instanceof RemoteVideoTrack) && !(t instanceof RemoteAudioTrack)) continue
      const st = await inbound(t)
      if (!st) continue
      const key = pub.trackSid
      const before = prev.get(key)
      prev.set(key, { at: now, ...st })
      if (!before) continue
      out.received += Math.max(0, (st.received ?? 0) - (before.received ?? 0))
      out.lost += Math.max(0, (st.lost ?? 0) - (before.lost ?? 0))
      const flowing = t instanceof RemoteVideoTrack && pub.isEnabled && !pub.isMuted
      if (flowing && st.frames !== undefined && before.frames !== undefined) {
        const df = Math.max(0, st.frames - before.frames)
        const dt = (now - before.at) / 1000
        if (dt > 0) fps.push(df / dt)
      }
    }
  }
  // Tracks that have gone (a departure, an unpublish) don't keep their counters.
  const live = new Set<string>()
  for (const p of room.remoteParticipants.values()) for (const sid of p.trackPublications.keys()) live.add(sid)
  for (const sid of prev.keys()) if (!live.has(sid)) prev.delete(sid)
  if (fps.length) out.recvFps = fps.reduce((a, b) => a + b, 0) / fps.length
  return out
}

/**
 * The receive counters, straight from the track's inbound-rtp report. Not
 * `getReceiverStats()`: for AUDIO livekit-client leaves out packetsReceived and
 * packetsLost, so loss on a call with every camera off — every low-bandwidth
 * call — would never have been counted.
 */
async function inbound(t: RemoteVideoTrack | RemoteAudioTrack): Promise<Omit<Counters, 'at'> | null> {
  const stats = await t.receiver?.getStats()
  if (!stats) return null
  let out: Omit<Counters, 'at'> | null = null
  stats.forEach((v: { type?: string; packetsReceived?: number; packetsLost?: number; framesDecoded?: number }) => {
    if (v.type !== 'inbound-rtp') return
    out = { received: v.packetsReceived, lost: v.packetsLost, frames: v.framesDecoded }
  })
  return out
}
