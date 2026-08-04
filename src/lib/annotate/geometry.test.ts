import { describe, it, expect } from 'vitest'
import { contentRect, toUnit, fromUnit, insideContent } from './geometry'

describe('contentRect (object-contain letterbox math)', () => {
  it('matching aspect fills the box exactly — no bars', () => {
    expect(contentRect(1600, 900, 16 / 9)).toEqual({ x: 0, y: 0, w: 1600, h: 900 })
  })

  it('wide content in a square box letterboxes top/bottom', () => {
    const r = contentRect(900, 900, 16 / 9)
    expect(r.w).toBe(900)
    expect(r.h).toBeCloseTo(506.25, 5)
    expect(r.x).toBe(0)
    // Bars are equal above and below.
    expect(r.y).toBeCloseTo((900 - 506.25) / 2, 5)
  })

  it('tall content in a wide box pillarboxes left/right', () => {
    const r = contentRect(1600, 900, 9 / 16)
    expect(r.h).toBe(900)
    expect(r.w).toBeCloseTo(506.25, 5)
    expect(r.y).toBe(0)
    expect(r.x).toBeCloseTo((1600 - 506.25) / 2, 5)
  })

  it('the content box never exceeds its container', () => {
    for (const aspect of [0.2, 0.5, 1, 1.777, 3.5, 21 / 9]) {
      for (const [bw, bh] of [
        [1600, 900],
        [390, 844],
        [900, 900],
        [1280, 300],
      ]) {
        const r = contentRect(bw, bh, aspect)
        expect(r.w).toBeLessThanOrEqual(bw + 1e-9)
        expect(r.h).toBeLessThanOrEqual(bh + 1e-9)
        expect(r.x).toBeGreaterThanOrEqual(-1e-9)
        expect(r.y).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })

  it('preserves the source aspect ratio', () => {
    for (const aspect of [0.4, 1, 16 / 9, 2.4]) {
      const r = contentRect(1024, 768, aspect)
      expect(r.w / r.h).toBeCloseTo(aspect, 6)
    }
  })

  it('degenerate inputs return a zero rect rather than NaN', () => {
    // The container measures 0x0 for a frame before ResizeObserver reports.
    expect(contentRect(0, 0, 16 / 9)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(contentRect(100, 100, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(contentRect(100, 100, Number.NaN)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(contentRect(100, 100, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('toUnit / fromUnit round-trip', () => {
  // The property the whole feature rests on: a stroke normalised on one client
  // and denormalised on another lands on the same CONTENT pixel, whatever the
  // two viewports are.
  it('round-trips within the content box across viewport shapes', () => {
    const aspects = [16 / 9, 4 / 3, 1, 9 / 16, 2.4]
    const boxes = [
      [1600, 900],
      [390, 844],
      [900, 900],
      [1280, 300],
    ]
    for (const aspect of aspects) {
      for (const [bw, bh] of boxes) {
        const rect = contentRect(bw, bh, aspect)
        for (const u of [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 0.5, y: 0.5 },
          { x: 0.13, y: 0.87 },
        ]) {
          const back = toUnit(fromUnit(u, rect), rect)
          expect(back.x).toBeCloseTo(u.x, 6)
          expect(back.y).toBeCloseTo(u.y, 6)
        }
      }
    }
  })

  it('the same unit point maps to the same content fraction on different viewports', () => {
    // Desktop and phone viewing the same 16:9 share.
    const desktop = contentRect(1600, 900, 16 / 9)
    const phone = contentRect(390, 500, 16 / 9)
    const u = { x: 0.25, y: 0.75 }
    const d = fromUnit(u, desktop)
    const p = fromUnit(u, phone)
    // Both sit a quarter across and three-quarters down their own content box.
    expect((d.x - desktop.x) / desktop.w).toBeCloseTo((p.x - phone.x) / phone.w, 9)
    expect((d.y - desktop.y) / desktop.h).toBeCloseTo((p.y - phone.y) / phone.h, 9)
  })

  it('clamps points in the letterbox bars to the content edge', () => {
    const rect = contentRect(900, 900, 16 / 9) // bars top and bottom
    expect(toUnit({ x: 450, y: 0 }, rect).y).toBe(0)
    expect(toUnit({ x: 450, y: 900 }, rect).y).toBe(1)
    expect(toUnit({ x: -50, y: 450 }, rect).x).toBe(0)
  })

  it('a zero content box degrades to origin instead of dividing by zero', () => {
    expect(toUnit({ x: 10, y: 10 }, { x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('insideContent', () => {
  const rect = contentRect(900, 900, 16 / 9) // letterboxed: bars above/below

  it('true inside the painted video', () => {
    expect(insideContent({ x: 450, y: 450 }, rect)).toBe(true)
  })

  it('false in the letterbox bars', () => {
    expect(insideContent({ x: 450, y: 5 }, rect)).toBe(false)
    expect(insideContent({ x: 450, y: 895 }, rect)).toBe(false)
  })

  it('false for a zero rect', () => {
    expect(insideContent({ x: 0, y: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(false)
  })
})
