import { describe, it, expect } from 'vitest'
import { isAutoLoadImageUrl, looksLikeImageUrl } from './limits'

describe('isAutoLoadImageUrl', () => {
  it('auto-loads the GIF picker CDNs', () => {
    expect(isAutoLoadImageUrl('https://media1.giphy.com/media/abc/giphy.gif')).toBe(true)
    expect(isAutoLoadImageUrl('https://media.tenor.com/xyz.gif')).toBe(true)
  })

  it('refuses a trusted name anywhere but the hostname', () => {
    // Each of these passed the old whole-URL regex and would auto-load — a
    // tracking pixel on every recipient's screen.
    expect(isAutoLoadImageUrl('https://evil.example/pixel.gif?x=.giphy.com')).toBe(false)
    expect(isAutoLoadImageUrl('https://giphy.com.evil.example/pixel.gif')).toBe(false)
    expect(isAutoLoadImageUrl('https://evil.example/media.tenor/p.gif')).toBe(false)
    expect(isAutoLoadImageUrl('https://notgiphy.com/p.gif')).toBe(false)
  })

  it('refuses non-https and non-URLs', () => {
    expect(isAutoLoadImageUrl('http://media.giphy.com/a.gif')).toBe(false)
    expect(isAutoLoadImageUrl('giphy.com')).toBe(false)
  })
})

describe('looksLikeImageUrl', () => {
  it('still recognises image links from any host (they render click-to-load)', () => {
    expect(looksLikeImageUrl('https://example.com/cat.png')).toBe(true)
    expect(looksLikeImageUrl('https://media.giphy.com/media/abc')).toBe(true)
    expect(looksLikeImageUrl('look https://example.com/cat.png')).toBe(false)
  })
})
