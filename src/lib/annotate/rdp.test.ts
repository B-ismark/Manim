import { describe, it, expect } from 'vitest'
import { simplify } from './rdp'

const pts = (...xs: number[]) => Float32Array.from(xs)
const count = (a: Float32Array) => a.length >> 1

describe('simplify (RDP)', () => {
  it('leaves strokes of two points or fewer untouched', () => {
    expect(simplify(pts(0, 0), 0.01)).toHaveLength(2)
    expect(simplify(pts(0, 0, 1, 1), 0.01)).toHaveLength(4)
  })

  it('collapses collinear points to the endpoints', () => {
    const line = pts(0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1)
    const out = simplify(line, 0.01)
    expect(count(out)).toBe(2)
    expect(Array.from(out)).toEqual([0, 0, 1, 1])
  })

  it('always keeps both endpoints', () => {
    const zig = pts(0, 0, 0.5, 0.4, 1, 0)
    const out = simplify(zig, 5) // epsilon large enough to drop everything droppable
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0)
    expect(out[out.length - 2]).toBe(1)
    expect(out[out.length - 1]).toBe(0)
  })

  it('keeps a point that deviates by more than epsilon', () => {
    const spike = pts(0, 0, 0.5, 0.5, 1, 0)
    expect(count(simplify(spike, 0.01))).toBe(3)
  })

  it('drops a point that deviates by less than epsilon', () => {
    const nearlyFlat = pts(0, 0, 0.5, 0.001, 1, 0)
    expect(count(simplify(nearlyFlat, 0.01))).toBe(2)
  })

  it('never increases the point count', () => {
    const n = 500
    const wave = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      wave[i * 2] = i / n
      wave[i * 2 + 1] = 0.5 + Math.sin(i / 7) * 0.2
    }
    for (const eps of [0.0001, 0.0015, 0.01, 0.1]) {
      expect(count(simplify(wave, eps))).toBeLessThanOrEqual(n)
    }
  })

  it('a larger epsilon never yields more points', () => {
    const n = 300
    const wave = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      wave[i * 2] = i / n
      wave[i * 2 + 1] = 0.5 + Math.sin(i / 5) * 0.3
    }
    let prev = Infinity
    for (const eps of [0.0005, 0.002, 0.01, 0.05]) {
      const c = count(simplify(wave, eps))
      expect(c).toBeLessThanOrEqual(prev)
      prev = c
    }
  })

  it('meaningfully reduces a dense coalesced-style stroke', () => {
    // What getCoalescedEvents() hands us: a smooth path sampled very densely.
    const n = 1200
    const dense = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const t = i / n
      dense[i * 2] = t
      dense[i * 2 + 1] = 0.5 + Math.sin(t * Math.PI * 2) * 0.25
    }
    expect(count(simplify(dense, 0.0015))).toBeLessThan(n / 4)
  })

  it('handles a very long stroke without overflowing the stack', () => {
    // The recursive formulation goes O(n) deep on a monotonic path; this is the
    // regression guard for the iterative one.
    const n = 60_000
    const long = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      long[i * 2] = i / n
      long[i * 2 + 1] = i / n
    }
    expect(() => simplify(long, 1e-9)).not.toThrow()
  })

  it('a non-positive epsilon is a no-op', () => {
    const p = pts(0, 0, 0.5, 0.5, 1, 1)
    expect(simplify(p, 0)).toHaveLength(6)
  })
})
