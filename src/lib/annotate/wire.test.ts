import { describe, it, expect } from 'vitest'
import {
  encode,
  decode,
  chunk,
  MAX_PACKET_BYTES,
  MAX_POINTS_PER_PACKET,
  HEADER_BYTES,
  WIRE_VERSION,
} from './wire'

const pts = (...xs: number[]) => Float32Array.from(xs)

describe('encode / decode', () => {
  it('round-trips header fields exactly', () => {
    const out = decode(encode({ colorIdx: 5, strokeId: 4242, seq: 7, points: pts(0.25, 0.75) }))
    expect(out).not.toBeNull()
    expect(out!.colorIdx).toBe(5)
    expect(out!.strokeId).toBe(4242)
    expect(out!.seq).toBe(7)
  })

  it('round-trips points within quantisation error', () => {
    const points = pts(0, 0, 0.5, 0.5, 1, 1, 0.123456, 0.987654)
    const out = decode(encode({ colorIdx: 0, strokeId: 1, seq: 0, points }))!
    expect(out.points.length).toBe(points.length)
    for (let i = 0; i < points.length; i++) {
      // 16-bit quantisation: 1/65535 is far below one screen pixel.
      expect(out.points[i]).toBeCloseTo(points[i], 4)
    }
  })

  it('preserves the exact endpoints 0 and 1', () => {
    const out = decode(encode({ colorIdx: 0, strokeId: 1, seq: 0, points: pts(0, 1) }))!
    expect(out.points[0]).toBe(0)
    expect(out.points[1]).toBe(1)
  })

  it('clamps out-of-range coordinates instead of wrapping', () => {
    const out = decode(encode({ colorIdx: 0, strokeId: 1, seq: 0, points: pts(-3, 4) }))!
    expect(out.points[0]).toBe(0)
    expect(out.points[1]).toBe(1)
  })

  it('encodes an empty stroke as a bare header', () => {
    expect(encode({ colorIdx: 0, strokeId: 1, seq: 0, points: pts() }).byteLength).toBe(HEADER_BYTES)
  })
})

describe('decode rejects bad input rather than throwing', () => {
  // The receive path runs on every inbound packet from every peer; a throw here
  // would take out the data channel handler.
  it('returns null for a truncated packet', () => {
    expect(decode(new Uint8Array(3))).toBeNull()
  })

  it('returns null for an unknown wire version', () => {
    const bytes = encode({ colorIdx: 1, strokeId: 1, seq: 0, points: pts(0.5, 0.5) })
    bytes[0] = WIRE_VERSION + 1
    expect(decode(bytes)).toBeNull()
  })

  it('returns null when the payload is not a whole number of points', () => {
    expect(decode(new Uint8Array(HEADER_BYTES + 3))).toBeNull()
  })

  it('decodes correctly when the view is offset inside a larger buffer', () => {
    // Data channel payloads often arrive as a view into a pooled buffer.
    const inner = encode({ colorIdx: 3, strokeId: 9, seq: 2, points: pts(0.5, 0.25) })
    const backing = new Uint8Array(inner.byteLength + 16)
    backing.set(inner, 8)
    const view = backing.subarray(8, 8 + inner.byteLength)
    const out = decode(view)!
    expect(out.colorIdx).toBe(3)
    expect(out.strokeId).toBe(9)
    expect(out.points[0]).toBeCloseTo(0.5, 4)
  })
})

describe('chunk', () => {
  it('keeps a short stroke in a single packet', () => {
    const out = chunk(pts(0.1, 0.1, 0.2, 0.2), 1, 1, 0)
    expect(out).toHaveLength(1)
    expect(out[0].seq).toBe(0)
  })

  it('returns nothing for an empty stroke', () => {
    expect(chunk(pts(), 1, 1, 0)).toEqual([])
  })

  it('every packet stays within the MTU budget', () => {
    const n = MAX_POINTS_PER_PACKET * 3 + 17
    const points = new Float32Array(n * 2)
    for (let i = 0; i < n * 2; i++) points[i] = (i % 100) / 100
    for (const p of chunk(points, 2, 77, 0)) {
      expect(encode(p).byteLength).toBeLessThanOrEqual(MAX_PACKET_BYTES)
    }
  })

  it('chunks overlap by one point so segments join across packets', () => {
    const n = MAX_POINTS_PER_PACKET + 40
    const points = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      points[i * 2] = i / n
      points[i * 2 + 1] = 0.5
    }
    const out = chunk(points, 0, 1, 0)
    expect(out.length).toBeGreaterThan(1)
    const first = out[0].points
    const second = out[1].points
    // Last point of packet N == first point of packet N+1.
    expect(second[0]).toBeCloseTo(first[first.length - 2], 6)
    expect(second[1]).toBeCloseTo(first[first.length - 1], 6)
  })

  it('covers every input point across the chunks', () => {
    const n = MAX_POINTS_PER_PACKET * 2 + 5
    const points = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      points[i * 2] = i / n
      points[i * 2 + 1] = 1 - i / n
    }
    const out = chunk(points, 0, 1, 0)
    // Rebuild, dropping each chunk's duplicated leading point.
    const seen: number[] = []
    out.forEach((p, idx) => {
      const start = idx === 0 ? 0 : 1
      for (let i = start; i < p.points.length >> 1; i++) seen.push(p.points[i * 2])
    })
    expect(seen).toHaveLength(n)
    expect(seen[0]).toBeCloseTo(points[0], 6)
    expect(seen[seen.length - 1]).toBeCloseTo(points[(n - 1) * 2], 6)
  })

  it('continues the sequence number from startSeq', () => {
    const n = MAX_POINTS_PER_PACKET * 2
    const points = new Float32Array(n * 2)
    const out = chunk(points, 0, 1, 12)
    expect(out[0].seq).toBe(12)
    expect(out[1].seq).toBe(13)
  })
})

describe('decode rejects hostile input', () => {
  it('refuses a packet larger than the encoder can produce', () => {
    // The receiver allocates in proportion to payload size, so an oversized packet
    // is either not ours or is trying to make us allocate. Cheaper to reject than
    // to decode and then discard.
    const huge = new Uint8Array(MAX_PACKET_BYTES + 4)
    huge[0] = WIRE_VERSION
    expect(decode(huge)).toBeNull()
  })

  it('still accepts a packet at exactly the cap', () => {
    const points = new Float32Array(MAX_POINTS_PER_PACKET * 2).fill(0.5)
    const bytes = encode({ colorIdx: 1, strokeId: 1, seq: 0, points })
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_PACKET_BYTES)
    expect(decode(bytes)).not.toBeNull()
  })
})
