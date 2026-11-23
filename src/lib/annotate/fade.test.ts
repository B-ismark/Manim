import { describe, it, expect } from 'vitest'
import {
  opacityForAge,
  isExpired,
  tailTrimForAge,
  dissolveOpacity,
  chipOpacity,
  HOLD_MS,
  FADE_MS,
  LIFETIME_MS,
  CHIP_HOLD_MS,
  CHIP_FADE_MS,
} from './fade'

describe('opacityForAge', () => {
  it('is fully opaque while held', () => {
    expect(opacityForAge(0)).toBe(1)
    expect(opacityForAge(HOLD_MS / 2)).toBe(1)
    expect(opacityForAge(HOLD_MS)).toBe(1)
  })

  it('reaches zero exactly at the end of life', () => {
    expect(opacityForAge(LIFETIME_MS)).toBe(0)
    expect(opacityForAge(LIFETIME_MS + 5000)).toBe(0)
  })

  it('decreases monotonically through the fade', () => {
    let prev = 1
    for (let age = HOLD_MS; age <= LIFETIME_MS; age += FADE_MS / 24) {
      const o = opacityForAge(age)
      expect(o).toBeLessThanOrEqual(prev + 1e-9)
      prev = o
    }
  })

  it('stays within [0,1] across the whole timeline', () => {
    for (let age = -500; age < LIFETIME_MS * 2; age += 37) {
      const o = opacityForAge(age)
      expect(o).toBeGreaterThanOrEqual(0)
      expect(o).toBeLessThanOrEqual(1)
    }
  })

  it('eases rather than ramping linearly', () => {
    // Smoothstep sits above the linear ramp early in the fade, which is what
    // stops the tail reading as an abrupt switch-off.
    const mid = HOLD_MS + FADE_MS / 4
    const linear = 1 - (mid - HOLD_MS) / FADE_MS
    expect(opacityForAge(mid)).toBeGreaterThan(linear)
  })

  it('treats a negative age (clock skew) as fresh', () => {
    expect(opacityForAge(-100)).toBe(1)
  })
})

describe('isExpired', () => {
  it('is false while the stroke is still visible', () => {
    expect(isExpired(0)).toBe(false)
    expect(isExpired(HOLD_MS)).toBe(false)
    expect(isExpired(LIFETIME_MS - 1)).toBe(false)
  })

  it('is true once fully faded', () => {
    expect(isExpired(LIFETIME_MS)).toBe(true)
    expect(isExpired(LIFETIME_MS + 1)).toBe(true)
  })

  it('agrees with opacityForAge at the boundary', () => {
    // The render loop parks itself when every stroke is expired, so "invisible"
    // and "expired" must not disagree — a stroke at opacity 0 that isn't expired
    // would keep the rAF loop alive forever.
    for (let age = 0; age < LIFETIME_MS * 1.5; age += 50) {
      if (isExpired(age)) expect(opacityForAge(age)).toBe(0)
    }
  })
})

describe('tail dissolve', () => {
  it('holds the whole stroke, then eats it from the tail over the fade', () => {
    expect(tailTrimForAge(0)).toBe(0)
    expect(tailTrimForAge(HOLD_MS)).toBe(0)
    const mid = tailTrimForAge(HOLD_MS + FADE_MS / 2)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(tailTrimForAge(LIFETIME_MS)).toBe(1)
  })

  it('keeps what is left solid until the last fifth, then fades it out', () => {
    expect(dissolveOpacity(0)).toBe(1)
    expect(dissolveOpacity(0.8)).toBeCloseTo(1)
    expect(dissolveOpacity(0.9)).toBeCloseTo(0.5)
    expect(dissolveOpacity(1)).toBe(0)
  })

  it('ends exactly when the stroke expires', () => {
    expect(dissolveOpacity(tailTrimForAge(LIFETIME_MS))).toBe(0)
  })
})

describe('chipOpacity', () => {
  it('is solid while points are arriving and gone about a second after', () => {
    expect(chipOpacity(0)).toBe(1)
    expect(chipOpacity(CHIP_HOLD_MS)).toBe(1)
    expect(chipOpacity(CHIP_HOLD_MS + CHIP_FADE_MS)).toBe(0)
    expect(CHIP_HOLD_MS + CHIP_FADE_MS).toBeLessThanOrEqual(1000)
    expect(CHIP_HOLD_MS + CHIP_FADE_MS).toBeLessThan(HOLD_MS)
  })
})
