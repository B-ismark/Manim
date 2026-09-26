import { describe, it, expect } from 'vitest'
import { seatKey, seatKeyValid, claimKey, claimKeyValid } from './seat.mjs'

const SECRET = 'livekit-api-secret'

describe('seat keys', () => {
  it('accepts the key issued for that room and identity', async () => {
    const k = await seatKey(SECRET, 'standup', 'Alice#d1')
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d1', k)).toBe(true)
  })

  it('rejects the key for any other identity, room or secret', async () => {
    const k = await seatKey(SECRET, 'standup', 'Alice#d1')
    // The exploit this closes: knowing Alice's identity is not the same as holding her seat.
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d2', k)).toBe(false)
    expect(await seatKeyValid(SECRET, 'other-room', 'Alice#d1', k)).toBe(false)
    expect(await seatKeyValid('different-secret', 'standup', 'Alice#d1', k)).toBe(false)
  })

  it('rejects a missing, empty or malformed key', async () => {
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d1', undefined)).toBe(false)
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d1', '')).toBe(false)
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d1', 'abc')).toBe(false)
    expect(await seatKeyValid(SECRET, 'standup', 'Alice#d1', 42)).toBe(false)
  })

  it('does not let a room/identity split collide with another', async () => {
    // Separator is a newline, which neither a slug nor the identity can carry.
    expect(await seatKey(SECRET, 'a', 'b#c')).not.toBe(await seatKey(SECRET, 'a#b', 'c'))
  })

  it('never validates without a server secret', async () => {
    expect(await seatKeyValid('', 'standup', 'Alice#d1', 'x')).toBe(false)
  })
})

describe('claim keys', () => {
  it('binds a waiting-room request id to the client that knocked', async () => {
    const c = await claimKey(SECRET, 'standup', 'req-1')
    expect(await claimKeyValid(SECRET, 'standup', 'req-1', c)).toBe(true)
    expect(await claimKeyValid(SECRET, 'standup', 'req-2', c)).toBe(false)
    expect(await claimKeyValid(SECRET, 'standup', 'req-1', undefined)).toBe(false)
  })

  it('is not interchangeable with a seat key', async () => {
    const s = await seatKey(SECRET, 'standup', 'req-1')
    expect(await claimKeyValid(SECRET, 'standup', 'req-1', s)).toBe(false)
  })
})
