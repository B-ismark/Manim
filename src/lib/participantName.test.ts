import { describe, it, expect } from 'vitest'
import { displayNameOf } from './participantName'

describe('displayNameOf', () => {
  it('prefers the participant’s own name', () => {
    expect(displayNameOf('ada#dev1', 'Ada Lovelace')).toBe('Ada Lovelace')
  })

  it('falls back to the identity’s name half, dropping the #device suffix', () => {
    expect(displayNameOf('ada#dev1')).toBe('ada')
    expect(displayNameOf('ada#dev1', '')).toBe('ada')
    expect(displayNameOf('ada')).toBe('ada')
  })

  it('uses the fallback when neither yields anything', () => {
    expect(displayNameOf('')).toBe('Guest')
    expect(displayNameOf('#dev1')).toBe('Guest')
    expect(displayNameOf('', undefined, 'Someone')).toBe('Someone')
    expect(displayNameOf('', undefined, '')).toBe('')
  })
})
