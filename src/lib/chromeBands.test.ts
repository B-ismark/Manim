import { describe, it, expect } from 'vitest'
import { ISLAND_H, ISLAND_INSET, islandBand } from './chromeBands'

describe('islandBand', () => {
  it('is the island’s height plus its 1rem floor when the device has no inset', () => {
    // The value Stage hardcoded. Every emulated device in the e2e suite is this
    // case, which is why the bug below shipped green.
    expect(islandBand(0)).toBe(76)
    expect(islandBand(0)).toBe(ISLAND_INSET + ISLAND_H)
  })

  it('grows with a real device’s inset, so the bar never floats above the band', () => {
    expect(islandBand(34)).toBe(94) // iOS home indicator
    expect(islandBand(24)).toBe(84) // Android gesture nav
  })

  it('never shrinks below the floor — a sub-1rem inset still clears the bar', () => {
    // The island's own offset is max(1rem, env(...)); the band has to use the same
    // max or it under-reserves on a device reporting a token 8px.
    expect(islandBand(8)).toBe(76)
  })

  it('adds a caller’s gutter on top', () => {
    expect(islandBand(0, 16)).toBe(92)
    expect(islandBand(34, 16)).toBe(110)
  })

  it('treats nonsense from the platform as no inset rather than propagating NaN', () => {
    expect(islandBand(NaN)).toBe(76)
    expect(islandBand(-5)).toBe(76)
  })
})
