import { describe, it, expect } from 'vitest'
import { withoutE2eeKey } from './invite.mjs'

describe('withoutE2eeKey', () => {
  it('keeps the join secret and drops the encryption key', () => {
    const { url, hadKey } = withoutE2eeKey('https://manim.app/r/standup#k=1.abc&e=SECRETKEY')
    expect(hadKey).toBe(true)
    expect(url.href).toBe('https://manim.app/r/standup#k=1.abc')
    expect(url.href).not.toContain('SECRETKEY')
  })

  it('leaves an unencrypted link alone', () => {
    const { url, hadKey } = withoutE2eeKey('https://manim.app/r/standup#k=1.abc')
    expect(hadKey).toBe(false)
    expect(url.href).toBe('https://manim.app/r/standup#k=1.abc')
  })

  it('drops an empty fragment entirely', () => {
    expect(withoutE2eeKey('https://manim.app/r/standup#e=only').url.href).toBe('https://manim.app/r/standup')
  })
})
