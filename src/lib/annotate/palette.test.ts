import { describe, it, expect } from 'vitest'
import { colorIndexFor, colorVar, PALETTE_SIZE } from './palette'

describe('colorIndexFor', () => {
  const roster = ['Ada#a', 'Bo#b', 'Cy#c', 'Dee#d']

  it('is stable for the same identity and roster', () => {
    expect(colorIndexFor('Bo#b', roster)).toBe(colorIndexFor('Bo#b', roster))
  })

  it('gives distinct colours to everyone up to the palette size', () => {
    const many = Array.from({ length: PALETTE_SIZE }, (_, i) => `p${i}#d`)
    const seen = new Set(many.map((id) => colorIndexFor(id, many)))
    expect(seen.size).toBe(PALETTE_SIZE)
  })

  it('agrees across clients that received the roster in different orders', () => {
    // LiveKit does not guarantee participant list ordering; if colour depended on
    // arrival order the same person would render differently on each screen.
    const shuffled = ['Dee#d', 'Ada#a', 'Cy#c', 'Bo#b']
    for (const id of roster) {
      expect(colorIndexFor(id, shuffled)).toBe(colorIndexFor(id, roster))
    }
  })

  it('always returns an index inside the palette', () => {
    const many = Array.from({ length: PALETTE_SIZE * 3 }, (_, i) => `p${i}#d`)
    for (const id of many) {
      const i = colorIndexFor(id, many)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(PALETTE_SIZE)
    }
  })

  it('falls back to a stable hash for an identity missing from the roster', () => {
    // A stroke can arrive a beat before the roster update that adds its sender.
    const a = colorIndexFor('Ghost#z', roster)
    const b = colorIndexFor('Ghost#z', roster)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(PALETTE_SIZE)
  })

  it('handles an empty roster', () => {
    const i = colorIndexFor('Solo#a', [])
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(PALETTE_SIZE)
  })
})

describe('colorVar', () => {
  it('maps indices to the app.css token names', () => {
    expect(colorVar(0)).toBe('--annotate-1')
    expect(colorVar(PALETTE_SIZE - 1)).toBe(`--annotate-${PALETTE_SIZE}`)
  })

  it('wraps out-of-range indices rather than emitting a missing token', () => {
    // colorIdx arrives off the wire, so it must be treated as untrusted.
    expect(colorVar(PALETTE_SIZE)).toBe('--annotate-1')
    expect(colorVar(-1)).toBe(`--annotate-${PALETTE_SIZE}`)
    expect(colorVar(999)).toMatch(/^--annotate-[1-8]$/)
  })
})
