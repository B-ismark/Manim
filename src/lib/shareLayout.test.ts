import { describe, it, expect } from 'vitest'
import {
  pickSplit,
  bigFraction,
  presentationLayout,
  userRegionCapacity,
  orderUsers,
  splitVisible,
  MIN_FRACTION,
  MAX_FRACTION,
} from './shareLayout'

describe('pickSplit', () => {
  it('wide stage -> horizontal (big left)', () => {
    expect(pickSplit(1280, 720)).toBe('horizontal')
  })
  it('portrait stage -> vertical (big top)', () => {
    expect(pickSplit(390, 720)).toBe('vertical')
  })
  it('exact square -> horizontal (w >= h)', () => {
    expect(pickSplit(600, 600)).toBe('horizontal')
  })
})

describe('bigFraction (adaptive)', () => {
  it('fills the stage when there are no user tiles', () => {
    expect(bigFraction(1280, 720, 0, 'horizontal')).toBe(1)
  })

  it('a landscape (16:9) share on a wide stage clamps to MAX', () => {
    // natural = (720 * 16/9) / 1280 = 1.0 -> clamps to MAX_FRACTION
    expect(bigFraction(1280, 720, 4, 'horizontal', 16 / 9)).toBe(MAX_FRACTION)
  })

  it('a portrait (9:16) share on a wide stage relaxes toward MIN (gives users room)', () => {
    // natural = (720 * 9/16) / 1280 = 0.316 -> clamps up to MIN_FRACTION
    expect(bigFraction(1280, 720, 4, 'horizontal', 9 / 16)).toBe(MIN_FRACTION)
  })

  it('a landscape share on a PORTRAIT phone (vertical split) does not eat the height', () => {
    // natural = (390 / (16/9)) / 720 = 0.305 -> MIN, so users get the rest (letterbox fix)
    expect(bigFraction(390, 720, 4, 'vertical', 16 / 9)).toBe(MIN_FRACTION)
  })

  it('a portrait share on a portrait phone stays large', () => {
    // natural = (390 / (9/16)) / 720 = 0.96 -> clamps to MAX
    expect(bigFraction(390, 720, 4, 'vertical', 9 / 16)).toBe(MAX_FRACTION)
  })

  it('never returns outside the clamp range', () => {
    for (const ar of [0.3, 0.5625, 1, 1.333, 1.778, 3]) {
      const f = bigFraction(1000, 700, 5, 'horizontal', ar)
      expect(f).toBeGreaterThanOrEqual(MIN_FRACTION)
      expect(f).toBeLessThanOrEqual(MAX_FRACTION)
    }
  })
})

describe('presentationLayout', () => {
  it('horizontal split: big left, grid right, regions + gap sum to the width', () => {
    const L = presentationLayout(1280, 720, 4, 16 / 9, 12)
    expect(L.split).toBe('horizontal')
    expect(L.big.h).toBe(720)
    expect(L.grid.h).toBe(720)
    expect(L.big.w + 12 + L.grid.w).toBe(1280)
    expect(L.grid.x).toBe(L.big.w + 12)
  })

  it('vertical split: big top, grid below, regions + gap sum to the height', () => {
    const L = presentationLayout(390, 720, 4, 16 / 9, 12)
    expect(L.split).toBe('vertical')
    expect(L.big.w).toBe(390)
    expect(L.grid.w).toBe(390)
    expect(L.big.h + 12 + L.grid.h).toBe(720)
    expect(L.grid.y).toBe(L.big.h + 12)
  })

  it('no users -> big fills the stage, grid is empty', () => {
    const L = presentationLayout(1280, 720, 0)
    expect(L.big).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(L.grid.w).toBe(0)
  })
})

describe('userRegionCapacity', () => {
  it('fits more tiles in a larger region', () => {
    const small = userRegionCapacity(200, 720, false)
    const large = userRegionCapacity(1000, 720, false)
    expect(large).toBeGreaterThan(small)
  })
  it('touch (coarse) fits more tiles at the same size (smaller minimums)', () => {
    expect(userRegionCapacity(400, 300, true)).toBeGreaterThanOrEqual(userRegionCapacity(400, 300, false))
  })
  it('always fits at least one tile', () => {
    expect(userRegionCapacity(10, 10, false)).toBe(1)
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
