/**
 * How smoothly a call actually ran, summarised into the coarse ranges the usage
 * counts allow (server/usage.mjs, docs/usage-counts.md).
 *
 * Why it exists: "the stream lags" has at least three different causes — the
 * device running out of CPU (blur, encoder), the network (distance to the LiveKit
 * edge, loss), or the app — and they need opposite fixes. Without numbers every fix
 * is a guess. One summary per person per call answers it:
 *
 *  - call_rtt   round trip to the LiveKit edge,      by the edge's continent
 *  - call_loss  share of incoming packets lost,      by the edge's continent
 *  - call_fps   frame rate of the video you watched, phone / desktop
 *  - call_limit why your camera was held back, if it was (cpu / bandwidth), phone / desktop
 *
 * Same rules as every other count: ranges, never the exact numbers; no room, no
 * person, no device id; the edge is the SERVER's region, not where you are.
 * This file is pure (no LiveKit, no timers) so the arithmetic is unit-tested;
 * useCallQualityReport feeds it.
 */

export interface QualitySample {
  /** Round trip to the edge, ms (undefined when nothing reported it this time). */
  rttMs?: number
  /** Incoming packets in this interval, across every remote track. */
  received: number
  lost: number
  /** Mean decoded fps over remote videos actually flowing (undefined: none were). */
  recvFps?: number
  /** Your camera's encoder limit right now, as WebRTC reports it (undefined: no camera). */
  limit?: string
}

export type RttRange = 'lt100' | '100-200' | '200-300' | '300plus'
export type LossRange = 'lt1' | '1-3' | '3-10' | '10plus'
export type FpsRange = 'lt10' | '10-20' | '20plus'
export type LimitReason = 'none' | 'cpu' | 'bandwidth' | 'other'
export type EdgeRegion = 'af' | 'eu' | 'na' | 'sa' | 'as' | 'oc' | 'other'

export interface QualitySummary {
  rtt?: RttRange
  loss?: LossRange
  fps?: FpsRange
  limit?: LimitReason
}

/** Fewer samples than this (~30s at one per 10s) says nothing; send nothing. */
export const MIN_SAMPLES = 3

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function rttRange(ms: number): RttRange {
  if (ms < 100) return 'lt100'
  if (ms < 200) return '100-200'
  if (ms < 300) return '200-300'
  return '300plus'
}

export function lossRange(pct: number): LossRange {
  if (pct < 1) return 'lt1'
  if (pct < 3) return '1-3'
  if (pct < 10) return '3-10'
  return '10plus'
}

export function fpsRange(fps: number): FpsRange {
  if (fps < 10) return 'lt10'
  if (fps < 20) return '10-20'
  return '20plus'
}

export function limitReason(r: string | undefined): LimitReason {
  return r === 'none' || r === 'cpu' || r === 'bandwidth' ? r : 'other'
}

/**
 * The continent of the LiveKit edge from `room.serverInfo.region`. The raw string
 * is never sent — only one of a handful of continents, and 'other' for anything
 * this doesn't recognise (so an unfamiliar name is visible as a count, not lost).
 */
export function edgeRegion(region: string | undefined): EdgeRegion {
  const r = (region ?? '').toLowerCase()
  if (!r) return 'other'
  if (/africa|johannesburg|\bza\b|south-?africa|lagos|nigeria|kenya/.test(r)) return 'af'
  if (/europe|\beu\b|eu-|germany|frankfurt|france|paris|marseille|london|\buk\b|amsterdam|netherlands|ireland|spain|madrid|italy|milan|sweden|stockholm|poland|warsaw/.test(r)) return 'eu'
  if (/brazil|sao-?paulo|são paulo|chile|argentina|south-?america|\bsa-/.test(r)) return 'sa'
  if (/\bus\b|us-|usa|america|virginia|ohio|oregon|california|texas|dallas|chicago|ashburn|canada|toronto|mexico/.test(r)) return 'na'
  if (/australia|sydney|melbourne|new-?zealand|oceania/.test(r)) return 'oc'
  if (/asia|india|mumbai|singapore|japan|tokyo|korea|seoul|hong-?kong|israel|dubai|uae|saudi|indonesia/.test(r)) return 'as'
  return 'other'
}

/** Most frequent value (ties go to the worse reason: cpu, then bandwidth). */
function dominant(reasons: LimitReason[]): LimitReason | undefined {
  if (!reasons.length) return undefined
  const order: LimitReason[] = ['cpu', 'bandwidth', 'other', 'none']
  let best: LimitReason = reasons[0]
  let bestN = -1
  for (const r of order) {
    const n = reasons.filter((x) => x === r).length
    if (n > bestN) {
      best = r
      bestN = n
    }
  }
  return best
}

/** The call's summary, or null when too short to mean anything. */
export function summarise(samples: QualitySample[]): QualitySummary | null {
  if (samples.length < MIN_SAMPLES) return null
  const out: QualitySummary = {}
  const rtt = median(samples.flatMap((s) => (s.rttMs === undefined ? [] : [s.rttMs])))
  if (rtt !== undefined) out.rtt = rttRange(rtt)
  const lost = samples.reduce((n, s) => n + s.lost, 0)
  const total = lost + samples.reduce((n, s) => n + s.received, 0)
  if (total > 0) out.loss = lossRange((lost / total) * 100)
  const fps = median(samples.flatMap((s) => (s.recvFps === undefined ? [] : [s.recvFps])))
  if (fps !== undefined) out.fps = fpsRange(fps)
  const limit = dominant(samples.flatMap((s) => (s.limit === undefined ? [] : [limitReason(s.limit)])))
  if (limit) out.limit = limit
  return out
}
