import { describe, it, expect } from 'vitest'
import type { Participant } from 'livekit-client'
// @ts-expect-error: plain JS server module
import { accountClaim } from '../../server/account.mjs'
import { isSameAccount, watchOtherSeats } from './sameAccount'
import type { Room } from 'livekit-client'

const SECRET = 'livekit-api-secret'
const ROOM = 'swift-falcon'

async function seat(identity: string, userId: string, extra: Record<string, unknown> = {}) {
  const claim = await accountClaim(SECRET, ROOM, identity, userId)
  return { identity, metadata: JSON.stringify({ host: false, userId, ...claim, ...extra }) } as unknown as Participant
}

describe('isSameAccount', () => {
  it('recognises your other device', async () => {
    const me = await seat('Ada#laptop', 'u-ada')
    const phone = await seat('Ada#phone', 'u-ada')
    expect(await isSameAccount(ROOM, me, phone)).toBe(true)
  })

  it('refuses someone who rewrote their userId to yours', async () => {
    const me = await seat('Ada#laptop', 'u-ada')
    const eve = await seat('Eve#x', 'u-eve')
    const forged = { identity: eve.identity, metadata: JSON.stringify({ ...JSON.parse(eve.metadata!), userId: 'u-ada' }) } as unknown as Participant
    expect(await isSameAccount(ROOM, me, forged)).toBe(false)
  })

  it('refuses a signature copied from your real device', async () => {
    const me = await seat('Ada#laptop', 'u-ada')
    const phone = await seat('Ada#phone', 'u-ada')
    const copy = { identity: 'Eve#x', metadata: phone.metadata } as unknown as Participant
    expect(await isSameAccount(ROOM, me, copy)).toBe(false)
  })

  it('refuses a claim from another call, and anyone with a different key', async () => {
    const me = await seat('Ada#laptop', 'u-ada')
    const elsewhere = {
      identity: 'Ada#phone',
      metadata: JSON.stringify({ userId: 'u-ada', ...(await accountClaim(SECRET, 'other-room', 'Ada#phone', 'u-ada')) }),
    } as unknown as Participant
    expect(await isSameAccount(ROOM, me, elsewhere)).toBe(false)
    const rogue = {
      identity: 'Ada#phone',
      metadata: JSON.stringify({ userId: 'u-ada', ...(await accountClaim('not-the-secret', ROOM, 'Ada#phone', 'u-ada')) }),
    } as unknown as Participant
    expect(await isSameAccount(ROOM, me, rogue)).toBe(false)
  })

  it('guests are never tied together', async () => {
    const me = await seat('Ada#laptop', '')
    const other = await seat('Ada#phone', '')
    expect(await isSameAccount(ROOM, me, other)).toBe(false)
  })
})

describe('watchOtherSeats', () => {
  it('trusts a connection, not a name: a stranger reusing your left device’s identity is not you', async () => {
    const me = await seat('Ada#laptop', 'u-ada')
    const phone = Object.assign(await seat('Ada#phone', 'u-ada'), { sid: 'PA_phone' })
    const handlers = new Map<string, () => void>()
    const room = {
      name: ROOM,
      localParticipant: me,
      remoteParticipants: new Map([[phone.identity, phone]]),
      on(ev: string, f: () => void) {
        handlers.set(ev, f)
        return room
      },
      off() {
        return room
      },
    }
    const w = watchOtherSeats(room as unknown as Room)
    await expect.poll(() => w.seats.has('PA_phone')).toBe(true)

    // The phone leaves; Eve knocks with the same name#device and gets her own token.
    room.remoteParticipants.delete(phone.identity)
    const eve = Object.assign(await seat('Ada#phone', 'u-eve'), { sid: 'PA_eve' })
    room.remoteParticipants.set(eve.identity, eve)
    handlers.get('participantConnected')!()
    await new Promise((r) => setTimeout(r, 50))
    expect(w.seats.has('PA_eve')).toBe(false)
    // What the phone said while it was here stays yours.
    expect(w.seats.has('PA_phone')).toBe(true)
    w.stop()
  })
})
