import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberSeat, seatFor } from './seatKeys'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('seat keys', () => {
  it('returns the key saved for a seat, and none for another', () => {
    rememberSeat('standup', 'Ama#d1', 'KEY1')
    expect(seatFor('standup', 'Ama#d1')).toBe('KEY1')
    expect(seatFor('standup', 'Ama#d2')).toBeUndefined()
    expect(seatFor('other', 'Ama#d1')).toBeUndefined()
  })

  it('counts the 30 days from the last save, not the first', () => {
    vi.setSystemTime(0)
    rememberSeat('standup', 'Ama#d1', 'KEY1')
    vi.setSystemTime(25 * DAY)
    rememberSeat('standup', 'Ama#d1', 'KEY2')
    vi.setSystemTime(40 * DAY)
    expect(seatFor('standup', 'Ama#d1')).toBe('KEY2')
    vi.setSystemTime(56 * DAY)
    expect(seatFor('standup', 'Ama#d1')).toBeUndefined()
  })
})
