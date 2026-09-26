import { describe, it, expect } from 'vitest'
import { cleanDisplayName, MAX_NAME_LEN } from './displayName'

describe('cleanDisplayName', () => {
  it('leaves an ordinary name alone, spaces and all', () => {
    expect(cleanDisplayName('Ama Mensah')).toBe('Ama Mensah')
    expect(cleanDisplayName('José 🎉')).toBe('José 🎉')
  })

  it('drops the identity separator and control characters', () => {
    expect(cleanDisplayName('Bob #2')).toBe('Bob 2')
    expect(cleanDisplayName('Tab\there\nnew')).toBe('Tabherenew')
  })

  it('caps the length the server accepts', () => {
    expect(cleanDisplayName('x'.repeat(200))).toHaveLength(MAX_NAME_LEN)
  })
})
