/**
 * Binary wire format for annotation strokes.
 *
 * DESIGN: every packet is SELF-DESCRIBING — there is no begin/end handshake.
 * Each one carries the stroke id, the author's palette index and its own points,
 * so a dropped packet costs one gap in one stroke rather than desynchronising a
 * stroke's state machine. That lets the whole feature run on the lossy channel,
 * which is what we want for ink: a late point is worse than a missing one, and
 * with the fade TTL any gap is gone in a couple of seconds anyway.
 *
 * Consecutive packets in a stroke REPEAT the previous packet's last point as
 * their first, so segments join seamlessly across the packet boundary without an
 * ordering guarantee.
 *
 * The author is deliberately NOT in the payload. It comes from the SFU-attributed
 * sender identity on the data packet — a payload field would be trivially
 * spoofable, letting someone attribute a drawing to a colleague. Same rule the
 * server already enforces for handoff and moderation in server/core.mjs.
 *
 * Layout (little-endian):
 *   u8  version
 *   u8  colorIdx
 *   u16 strokeId   — rolling, per sender
 *   u16 seq        — packet index within the stroke
 *   u16 x, u16 y   — repeated; unit coords quantised to 0..65535
 */

export const WIRE_VERSION = 1

export const HEADER_BYTES = 6
export const BYTES_PER_POINT = 4

/**
 * Hard cap per packet. LiveKit recommends staying under the ~1400-byte network
 * MTU for lossy delivery; 1100 leaves comfortable headroom for LiveKit's own
 * framing so a packet is never fragmented.
 */
export const MAX_PACKET_BYTES = 1100

/** Most points that fit in one packet. */
export const MAX_POINTS_PER_PACKET = Math.floor((MAX_PACKET_BYTES - HEADER_BYTES) / BYTES_PER_POINT)

export interface StrokePacket {
  colorIdx: number
  strokeId: number
  seq: number
  /** Flat [x0,y0,x1,y1,…] in unit space (0..1). */
  points: Float32Array
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const quantize = (v: number) => Math.round(clamp01(v) * 65535)

/** Encode one packet. Callers must respect MAX_POINTS_PER_PACKET — see chunk(). */
export function encode(p: StrokePacket): Uint8Array {
  const n = p.points.length >> 1
  const buf = new ArrayBuffer(HEADER_BYTES + n * BYTES_PER_POINT)
  const view = new DataView(buf)
  view.setUint8(0, WIRE_VERSION)
  view.setUint8(1, p.colorIdx & 0xff)
  view.setUint16(2, p.strokeId & 0xffff, true)
  view.setUint16(4, p.seq & 0xffff, true)
  let off = HEADER_BYTES
  for (let i = 0; i < n; i++) {
    view.setUint16(off, quantize(p.points[i * 2]), true)
    view.setUint16(off + 2, quantize(p.points[i * 2 + 1]), true)
    off += BYTES_PER_POINT
  }
  return new Uint8Array(buf)
}

/**
 * Decode a packet. Returns null for anything malformed or from a future wire
 * version — a broadcast channel has no negotiation, so an unrecognised packet
 * must be ignored rather than throwing into the receive path.
 */
export function decode(bytes: Uint8Array): StrokePacket | null {
  if (bytes.byteLength < HEADER_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint8(0) !== WIRE_VERSION) return null
  const payload = bytes.byteLength - HEADER_BYTES
  if (payload % BYTES_PER_POINT !== 0) return null

  const n = payload / BYTES_PER_POINT
  const points = new Float32Array(n * 2)
  let off = HEADER_BYTES
  for (let i = 0; i < n; i++) {
    points[i * 2] = view.getUint16(off, true) / 65535
    points[i * 2 + 1] = view.getUint16(off + 2, true) / 65535
    off += BYTES_PER_POINT
  }
  return {
    colorIdx: view.getUint8(1),
    strokeId: view.getUint16(2, true),
    seq: view.getUint16(4, true),
    points,
  }
}

/**
 * Split a run of points into packets that each fit MAX_PACKET_BYTES.
 *
 * Each packet after the first repeats the previous packet's last point, so the
 * receiver can join them without relying on ordering or delivery. `startSeq`
 * continues the sequence for a stroke already in flight.
 */
export function chunk(
  points: Float32Array,
  colorIdx: number,
  strokeId: number,
  startSeq: number,
): StrokePacket[] {
  const n = points.length >> 1
  if (n === 0) return []
  if (n <= MAX_POINTS_PER_PACKET) {
    return [{ colorIdx, strokeId, seq: startSeq, points }]
  }

  const out: StrokePacket[] = []
  let i = 0
  let seq = startSeq
  while (i < n) {
    // Overlap one point with the previous chunk so the segments connect.
    const from = i === 0 ? 0 : i - 1
    const to = Math.min(from + MAX_POINTS_PER_PACKET, n)
    out.push({
      colorIdx,
      strokeId,
      seq: seq++,
      points: points.slice(from * 2, to * 2),
    })
    if (to >= n) break
    i = to
  }
  return out
}
