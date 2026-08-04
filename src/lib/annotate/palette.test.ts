import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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


describe('the palette itself (app.css)', () => {
  // The colours live in CSS, but their SEPARATION is a correctness property the
  // feature depends on, so it is asserted here rather than left to review.
  const css = readFileSync(
    fileURLToPath(new URL('../../styles/app.css', import.meta.url)),
    'utf8',
  )

  const entries = Array.from({ length: PALETTE_SIZE }, (_, i) => {
    const m = css.match(
      new RegExp(`--annotate-${i + 1}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`),
    )
    return m ? { i: i + 1, l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null
  })

  it('defines all eight colours', () => {
    expect(entries.filter(Boolean)).toHaveLength(PALETTE_SIZE)
  })

  it('is declared OUTSIDE @theme so Tailwind cannot tree-shake it', () => {
    // Regression guard. Inside @theme, Tailwind v4 drops theme variables that no
    // generated utility references — and nothing emits a `bg-annotate-3` class,
    // since these are read by the canvas via getComputedStyle. Seven of the eight
    // silently vanished from the build that way, collapsing every author onto one
    // fallback colour.
    const themeStart = css.indexOf('@theme {')
    const themeEnd = css.indexOf('\n}\n', themeStart)
    const themeBlock = css.slice(themeStart, themeEnd)
    expect(themeBlock).not.toContain('--annotate-')
    expect(css).toContain('--annotate-1')
  })

  it('spreads lightness widely enough to survive colour-vision deficiency', () => {
    // Hue alone is not enough: the Deuteranopia and Tritanopia presets ship as
    // first-class themes and collapse whole hue ranges. Lightness is the channel
    // that always survives, so the set must span a real range.
    const ls = entries.map((e) => e!.l)
    expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThanOrEqual(0.35)
  })

  it('has no pair that is close in BOTH lightness and hue', () => {
    // Two authors are confusable only if neither channel separates them.
    const hueGap = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360
      return d > 180 ? 360 - d : d
    }
    const tooClose: string[] = []
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!
        const b = entries[j]!
        if (Math.abs(a.l - b.l) < 0.045 && hueGap(a.h, b.h) < 40) {
          tooClose.push(`--annotate-${a.i} vs --annotate-${b.i}`)
        }
      }
    }
    expect(tooClose).toEqual([])
  })
})
