import { describe, it, expect } from 'vitest'
import { readinessLine } from './useRoomReadiness'

const live = { state: 'live' as const, count: 3, hostHere: true, youAreHost: false, waiting: false, locked: false, full: false }

describe('readinessLine', () => {
  it('says nothing it can’t vouch for', () => {
    expect(readinessLine({ state: 'unknown' })).toBeNull()
  })
  it('tells you when you’d be walking into an empty room', () => {
    expect(readinessLine({ state: 'empty' })?.text).toBe('No one else is here yet')
  })
  it('counts people, in the singular too', () => {
    expect(readinessLine(live)?.text).toBe('3 people in the call')
    expect(readinessLine({ ...live, count: 1 })?.text).toBe('1 person in the call')
  })
  it('says the host hasn’t joined, and what that means with a waiting room', () => {
    expect(readinessLine({ ...live, hostHere: false })?.text).toBe('3 in the call · Host isn’t here yet')
    expect(readinessLine({ ...live, hostHere: false, waiting: true })?.text).toBe(
      '3 in the call · Waiting for the host',
    )
    expect(readinessLine({ ...live, waiting: true })?.text).toBe('3 in the call · Host will let you in')
  })
  it('warns about a locked or full call, but not to its own host', () => {
    expect(readinessLine({ ...live, locked: true })?.tone).toBe('warn')
    expect(readinessLine({ ...live, full: true })?.text).toBe('This call is full')
    expect(readinessLine({ ...live, locked: true, youAreHost: true })?.text).toBe('3 people in the call')
  })
})
