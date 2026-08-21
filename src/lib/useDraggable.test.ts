import { describe, it, expect } from 'vitest'
import { cornerPosition, nearestCorner, type Corner } from './useDraggable'

// A 375×667 phone: 8px margin, and 76px reserved at the bottom for the control
// island (its 60px height plus its 16px inset).
const BOUNDS = { left: 8, top: 8, right: 367, bottom: 583 }
const CARD = { w: 88, h: 117 }

describe('nearestCorner', () => {
  const at = (x: number, y: number) => nearestCorner({ x, y, ...CARD }, BOUNDS)

  it('picks the corner the card is already in', () => {
    expect(at(8, 8)).toBe('tl')
    expect(at(279, 8)).toBe('tr')
    expect(at(8, 466)).toBe('bl')
    expect(at(279, 466)).toBe('br')
  })

  it('picks by the card centre, not its origin', () => {
    // Origin left of the midline but the card straddles it and sits mostly right.
    const midX = (BOUNDS.left + BOUNDS.right) / 2
    expect(at(midX - 10, 300)).toBe('br')
    expect(at(midX - CARD.w, 300)).toBe('bl')
  })

  it('resolves a card parked mid-edge, which a free drag used to allow', () => {
    expect(at(8, 300)).toBe('bl')
    expect(at(279, 200)).toBe('tr')
  })

  it('splits on the card CENTRE against the midline, not its top edge', () => {
    // midY = (8 + 583) / 2 = 295.5, so a 117px-tall card flips at y = 237.
    expect(at(279, 236)).toBe('tr')
    expect(at(279, 238)).toBe('br')
  })
})

describe('cornerPosition', () => {
  const b = { ...BOUNDS, w: CARD.w, h: CARD.h }

  it('parks the card inside the bounds at every corner', () => {
    for (const c of ['tl', 'tr', 'bl', 'br'] as Corner[]) {
      const p = cornerPosition(c, CARD, BOUNDS)
      expect(p.x).toBeGreaterThanOrEqual(BOUNDS.left)
      expect(p.y).toBeGreaterThanOrEqual(BOUNDS.top)
      expect(p.x + CARD.w).toBeLessThanOrEqual(BOUNDS.right)
      expect(p.y + CARD.h).toBeLessThanOrEqual(BOUNDS.bottom)
    }
  })

  it('never parks the card under the control island', () => {
    // The reserved band is already out of `bottom`, so the bottom corners stop above it.
    expect(cornerPosition('br', CARD, BOUNDS).y + CARD.h).toBeLessThanOrEqual(BOUNDS.bottom)
    expect(cornerPosition('bl', CARD, BOUNDS).y + CARD.h).toBeLessThanOrEqual(BOUNDS.bottom)
  })

  it('round-trips: park in a corner, and that is the corner it reads as', () => {
    for (const c of ['tl', 'tr', 'bl', 'br'] as Corner[]) {
      const p = cornerPosition(c, CARD, BOUNDS)
      expect(nearestCorner({ ...p, ...CARD }, BOUNDS)).toBe(c)
    }
    void b
  })

  it('survives a box larger than its bounds instead of going negative', () => {
    const huge = { w: 1000, h: 1000 }
    const p = cornerPosition('br', huge, BOUNDS)
    expect(p.x).toBe(BOUNDS.left)
    expect(p.y).toBe(BOUNDS.top)
  })

  it('a remembered corner still means something at a different viewport size', () => {
    const landscape = { left: 8, top: 8, right: 659, bottom: 291 }
    const p = cornerPosition('br', CARD, landscape)
    expect(p.x + CARD.w).toBeLessThanOrEqual(landscape.right)
    expect(p.y + CARD.h).toBeLessThanOrEqual(landscape.bottom)
  })
})
