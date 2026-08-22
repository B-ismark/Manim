import { describe, it, expect } from 'vitest'
import { speakerLayout, contentLayout, orderUsers, splitVisible } from './shareLayout'

/** Every layout must tile the stage exactly: regions + gap account for all of it. */
function coversStage(L: { big: { x: number; y: number; w: number; h: number }; strip: { w: number; h: number } }, side: string, w: number, h: number, gap: number) {
  if (side === 'top') return L.big.y === L.strip.h + gap && L.big.h + L.strip.h + gap === h && L.big.w === w
  if (side === 'right') return L.big.w + L.strip.w + gap === w && L.big.h === h
  return L.big.h + L.strip.h + gap === h && L.big.w === w
}

describe('speakerLayout', () => {
  it('puts the filmstrip along the TOP, clear of the bottom control island', () => {
    const L = speakerLayout(1280, 720, 4)
    expect(L.side).toBe('top')
    expect(L.strip.y).toBe(0)
    expect(L.big.y).toBe(L.strip.h + 12)
    expect(coversStage(L, 'top', 1280, 720, 12)).toBe(true)
  })

  it('gives the big tile the whole stage when nobody else is on it', () => {
    const L = speakerLayout(1280, 720, 0)
    expect(L.capacity).toBe(0)
    expect(L.big).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(L.strip).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('keeps the strip legible at every stage size (88..132px)', () => {
    for (const h of [400, 720, 1080, 2160]) {
      const L = speakerLayout((h * 16) / 9, h, 6)
      expect(L.strip.h).toBeGreaterThanOrEqual(88)
      expect(L.strip.h).toBeLessThanOrEqual(132)
    }
  })

  it('thumbnails are 16:9 and capacity is how many actually fit across', () => {
    const L = speakerLayout(1280, 720, 20)
    expect(L.tile.w / L.tile.h).toBeCloseTo(16 / 9, 5)
    expect(L.capacity).toBe(Math.floor((1280 + 12) / (L.tile.w + 12)))
  })

  it('drops the strip rather than crush the big tile on a very short stage', () => {
    const L = speakerLayout(1280, 260, 4)
    expect(L.capacity).toBe(0)
    expect(L.big.h).toBe(260)
  })
})

describe('contentLayout', () => {
  it('landscape stage: the share keeps the height, people ride a RIGHT rail', () => {
    const L = contentLayout(1440, 810, 5)
    expect(L.side).toBe('right')
    expect(L.big.h).toBe(810)
    expect(L.strip.x).toBe(L.big.w + 12)
    expect(coversStage(L, 'right', 1440, 810, 12)).toBe(true)
  })

  it('portrait stage: the share keeps the width, people ride a BOTTOM strip', () => {
    const L = contentLayout(420, 900, 5)
    expect(L.side).toBe('bottom')
    expect(L.big.w).toBe(420)
    expect(coversStage(L, 'bottom', 420, 900, 12)).toBe(true)
  })

  it('a 16:9 share on a 16:9 stage is NOT letterboxed to make room (the old clamp)', () => {
    // The adaptive split clamped the big region to 85% of the stage even when the
    // content wanted all of it. The rail now costs a bounded slice of the WIDTH,
    // and the share keeps every pixel of the height.
    const L = contentLayout(1600, 900, 3)
    expect(L.big.h).toBe(900)
    expect(L.big.w / L.big.h).toBeGreaterThan(1.4)
  })

  it('the rail stays a rail — never more than ~17% of a wide stage, bounded either side', () => {
    for (const w of [1000, 1440, 1920, 3840]) {
      const L = contentLayout(w, Math.round(w / 1.78), 4)
      expect(L.strip.w).toBeGreaterThanOrEqual(168)
      expect(L.strip.w).toBeLessThanOrEqual(232)
    }
  })

  it('flips a too-narrow landscape stage to a bottom strip instead of a sliver share', () => {
    const L = contentLayout(500, 460, 4)
    expect(L.side).toBe('bottom')
    expect(L.big.w).toBe(500)
  })

  it('insets the right rail for the top-right chrome, and charges the RAIL for it', () => {
    const plain = contentLayout(1440, 810, 5)
    const inset = contentLayout(1440, 810, 5, 12, 68)
    expect(inset.strip.y).toBe(68)
    expect(inset.strip.h).toBe(810 - 68)
    // The share is untouched — the rail pays, not the content.
    expect(inset.big).toEqual(plain.big)
    // …and capacity reflects the space the tiles actually get.
    expect(inset.capacity).toBeLessThanOrEqual(plain.capacity)
  })

  it('a bottom strip is not inset — nothing overlays it', () => {
    const L = contentLayout(420, 900, 5, 12, 68)
    expect(L.side).toBe('bottom')
    expect(L.big.y).toBe(0)
    expect(L.strip.y).toBe(L.big.h + 12)
  })

  it('no people -> the share fills the stage', () => {
    const L = contentLayout(1440, 810, 0)
    expect(L.capacity).toBe(0)
    expect(L.big).toEqual({ x: 0, y: 0, w: 1440, h: 810 })
  })
})

describe('orderUsers', () => {
  type U = { id: string; video: boolean }
  const hasVideo = (u: U) => u.video
  const key = (u: U) => u.id

  it('video-on tiles sort ahead of camera-off ones', () => {
    const users: U[] = [
      { id: 'a', video: false },
      { id: 'b', video: true },
      { id: 'c', video: false },
      { id: 'd', video: true },
    ]
    const out = orderUsers(users, hasVideo, key).map((u) => u.id)
    expect(out).toEqual(['b', 'd', 'a', 'c'])
  })

  it('is stable by key within a band (no jitter)', () => {
    const users: U[] = [
      { id: 'z', video: true },
      { id: 'a', video: true },
    ]
    expect(orderUsers(users, hasVideo, key).map((u) => u.id)).toEqual(['a', 'z'])
  })
})

describe('splitVisible', () => {
  const items = Array.from({ length: 10 }, (_, i) => i)

  it('shows everyone when they fit (no overflow)', () => {
    const { shown, overflow } = splitVisible(items.slice(0, 5), 6)
    expect(shown).toHaveLength(5)
    expect(overflow).toBe(0)
  })

  it('reserves the last slot for overflow when exceeding capacity', () => {
    const { shown, overflow } = splitVisible(items, 6)
    // capacity 6 -> 5 real tiles + 1 overflow slot; overflow counts the 5 hidden
    expect(shown).toHaveLength(5)
    expect(overflow).toBe(5)
    expect(shown.length + overflow).toBe(items.length)
  })
})
