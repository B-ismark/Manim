import { describe, it, expect } from 'vitest'
import { linkWithoutKey } from './roomLink'

describe('linkWithoutKey', () => {
  it('keeps the join secret and drops the encryption key', () => {
    const out = linkWithoutKey('https://manim.app/r/standup#k=1.abc&e=SECRETKEY')
    expect(out).toEqual({ href: 'https://manim.app/r/standup#k=1.abc', hadKey: true })
  })

  it('leaves a link with no key as it was', () => {
    expect(linkWithoutKey('https://manim.app/r/standup#k=1.abc')).toEqual({
      href: 'https://manim.app/r/standup#k=1.abc',
      hadKey: false,
    })
    expect(linkWithoutKey('https://manim.app/r/open').href).toBe('https://manim.app/r/open')
  })
})
