import { describe, it, expect, beforeEach } from 'vitest'
import { clearTrouble, formatElapsed, noteTrouble, troubleSince } from './connectionTrouble'

describe('connectionTrouble', () => {
  beforeEach(() => clearTrouble())
  it('keeps the first moment the trouble started', () => {
    noteTrouble(1000)
    noteTrouble(5000)
    expect(troubleSince()).toBe(1000)
    clearTrouble()
    expect(troubleSince()).toBe(0)
  })
  it('formats the clock the way a person reads it', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(12_400)).toBe('0:12')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(750_000)).toBe('12:30')
  })
})
