import { describe, it, expect } from 'vitest'
import { keyboardOverlap } from './keyboardInset'

const vv = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale })

describe('keyboardOverlap', () => {
  it('reports the gap between the layout and visual viewports', () => {
    // iPhone-ish: 844pt layout viewport, keyboard takes 336.
    expect(keyboardOverlap(844, vv(508))).toBe(336)
    // Pixel-ish.
    expect(keyboardOverlap(915, vv(636))).toBe(279)
  })

  it('is zero with no keyboard up', () => {
    expect(keyboardOverlap(844, vv(844))).toBe(0)
  })

  it('credits a scrolled visual viewport instead of double-counting it', () => {
    // The browser scrolled the visual viewport down by 120 to keep the focused
    // field visible, so only 216 of the 336 is still covering the bottom anchor.
    expect(keyboardOverlap(844, vv(508, 120))).toBe(216)
  })

  it('ignores browser chrome and rounding', () => {
    // A collapsing Android address bar is ~56px; reacting to it would make the
    // sheet twitch on scroll.
    expect(keyboardOverlap(915, vv(859))).toBe(0)
    expect(keyboardOverlap(915, vv(914.6))).toBe(0)
  })

  it('ignores pinch zoom, which shortens the visual viewport for its own reasons', () => {
    expect(keyboardOverlap(844, vv(422, 0, 2))).toBe(0)
    expect(keyboardOverlap(844, vv(508, 0, 1.02))).toBe(336) // within tolerance
  })

  it('never returns a negative offset', () => {
    // A visual viewport taller than the layout one (transient, mid-rotation).
    expect(keyboardOverlap(500, vv(700))).toBe(0)
  })

  it('survives a viewport that reports nothing usable', () => {
    expect(keyboardOverlap(NaN, vv(508))).toBe(0)
    expect(keyboardOverlap(844, vv(NaN))).toBe(0)
  })
})
