import { describe, expect, it } from 'vitest'
import { BAR_FOLD_MAX, nextFoldLevel } from './barFold'

describe('nextFoldLevel', () => {
  it('folds one control at a time while the bar overflows', () => {
    expect(nextFoldLevel(0, 600, 528)).toBe(1)
    expect(nextFoldLevel(1, 560, 528)).toBe(2)
  })

  it('stops as soon as the bar fits', () => {
    expect(nextFoldLevel(1, 500, 528)).toBe(1)
    expect(nextFoldLevel(0, 528, 528)).toBe(0)
  })

  it('never folds past the last level, even if the bar still overflows', () => {
    expect(nextFoldLevel(BAR_FOLD_MAX, 400, 288)).toBe(BAR_FOLD_MAX)
  })

  it('reaches the narrow bar from scratch at 320px in at most BAR_FOLD_MAX steps', () => {
    // Widths a host's bar takes at each level (roughly measured), against 288px of room.
    const widths = [540, 492, 492, 440, 270]
    let level = 0
    for (let i = 0; i < 10; i++) level = nextFoldLevel(level, widths[level], 288)
    expect(level).toBe(BAR_FOLD_MAX)
  })
})
