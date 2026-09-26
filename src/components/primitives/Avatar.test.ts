import { describe, it, expect } from 'vitest'
import { initials } from './Avatar'

describe('initials', () => {
  it('takes whole characters, so an emoji-led name stays intact', () => {
    expect(initials('😀 Bob')).toBe('😀B')
    expect(initials('🎉')).toBe('🎉')
  })

  it('keeps the usual rules for plain names', () => {
    expect(initials('ama mensah')).toBe('AM')
    expect(initials('Kofi')).toBe('KO')
    expect(initials('   ')).toBe('?')
  })
})
