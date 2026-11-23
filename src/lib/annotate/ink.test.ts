import { describe, it, expect } from 'vitest'
import {
  densify,
  outline,
  inkSize,
  chipTextColor,
  chipBox,
  CHIP_TEXT_DARK,
  CHIP_TEXT_LIGHT,
  MAX_DENSE_POINTS,
  MIN_INK_PX,
  MAX_INK_PX,
} from './ink'

describe('densify', () => {
  it('keeps a lone point, so a tap still draws a dot', () => {
    expect(densify([5, 6], 1, 2)).toEqual([5, 6])
  })

  it('passes through every original point', () => {
    const pts = [0, 0, 100, 0, 100, 100]
    const d = densify(pts, 3, 5)
    const has = (x: number, y: number) =>
      d.some((_, i) => i % 2 === 0 && Math.abs(d[i] - x) < 1e-6 && Math.abs(d[i + 1] - y) < 1e-6)
    expect(has(0, 0) && has(100, 0) && has(100, 100)).toBe(true)
  })

  it('turns a sparse corner into a curve (what a viewer receives after RDP)', () => {
    // Three wire points of a quarter turn: a polyline would cut the corner with
    // a straight chord; the spline bows out past it.
    const d = densify([0, 0, 100, 0, 100, 100], 3, 2)
    const n = d.length / 2
    expect(n).toBeGreaterThan(50)
    const beyondChord = d.some((_, i) => i % 2 === 0 && d[i] > 100.5)
    expect(beyondChord).toBe(true)
  })

  it('caps the resampled size of a very long stroke', () => {
    const pts: number[] = []
    for (let i = 0; i < 400; i++) pts.push(i * 50, (i % 2) * 50)
    expect(densify(pts, 400, 1).length / 2).toBeLessThanOrEqual(MAX_DENSE_POINTS + 400)
  })
})

describe('outline', () => {
  it('produces a closed polygon around a line', () => {
    const d = densify([0, 0, 200, 0], 2, 2)
    const o = outline(d, 0, 6, true)
    expect(o.length).toBeGreaterThan(10)
    const ys = o.map((p) => p[1])
    expect(Math.max(...ys)).toBeGreaterThan(0)
    expect(Math.min(...ys)).toBeLessThan(0)
  })

  it('starts later when the tail has dissolved', () => {
    const d = densify([0, 0, 200, 0], 2, 2)
    const xs = (o: number[][]) => Math.min(...o.map((p) => p[0]))
    expect(xs(outline(d, Math.floor(d.length / 4), 6, true))).toBeGreaterThan(xs(outline(d, 0, 6, true)) + 50)
  })
})

describe('inkSize', () => {
  it('scales with the content and stays within bounds', () => {
    expect(inkSize(100, 50)).toBe(MIN_INK_PX)
    expect(inkSize(8000, 4000)).toBe(MAX_INK_PX)
    expect(inkSize(1920, 1080)).toBeCloseTo(1080 * 0.0075)
  })
})

describe('chipTextColor', () => {
  it('uses light text only on the darkest palette colour', () => {
    expect(chipTextColor('oklch(0.53 0.15 250)')).toBe(CHIP_TEXT_LIGHT) // blue
    for (const l of ['0.6', '0.65', '0.66', '0.75', '0.9', '0.95']) {
      expect(chipTextColor(`oklch(${l} 0.1 100)`)).toBe(CHIP_TEXT_DARK)
    }
  })

  it('reads percentage lightness', () => {
    expect(chipTextColor('oklch(40% 0.1 250)')).toBe(CHIP_TEXT_LIGHT)
  })

  it('falls back to dark text for anything it cannot read', () => {
    expect(chipTextColor('#123456')).toBe(CHIP_TEXT_DARK)
  })
})

describe('chipBox', () => {
  const content = { x: 0, y: 0, w: 400, h: 300 }

  it('sits below-right of the pen', () => {
    const b = chipBox(100, 100, 30, content)
    expect(b.x).toBeGreaterThan(100)
    expect(b.y).toBeGreaterThan(100)
  })

  it('flips left and up at the far edges, staying inside the content', () => {
    const b = chipBox(395, 295, 30, content)
    expect(b.x + b.w).toBeLessThanOrEqual(395)
    expect(b.y + b.h).toBeLessThanOrEqual(295)
    expect(b.x).toBeGreaterThanOrEqual(0)
  })

  it('never leaves a content box smaller than itself', () => {
    const b = chipBox(5, 5, 300, { x: 10, y: 10, w: 100, h: 100 })
    expect(b.x).toBeGreaterThanOrEqual(10 - 300) // clamped, does not throw
    expect(Number.isFinite(b.y)).toBe(true)
  })
})
