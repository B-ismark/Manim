import { describe, it, expect } from 'vitest'
import { AVATAR_C, AVATAR_L, initials } from './Avatar'

describe('initials', () => {
  it('takes whole characters, so an emoji-led name stays intact', () => {
    expect(initials('😀 Bob')).toBe('😀B')
    expect(initials('🎉')).toBe('🎉')
  })

  it('keeps the usual rules for plain names', () => {
    expect(initials('ama mensah')).toBe('AM')
    expect(initials('Kofi')).toBe('KO')
    expect(initials('   ')).toBe('?')
  })
})

/** oklch → linear sRGB (clamped to gamut), then WCAG relative luminance. */
function luminance(L: number, C: number, h: number): number {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

describe('avatar colours', () => {
  it('give white initials at least 4.5:1 on every hue', () => {
    let worst = Infinity
    for (let h = 0; h < 360; h++) worst = Math.min(worst, 1.05 / (luminance(AVATAR_L, AVATAR_C, h) + 0.05))
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })
})
