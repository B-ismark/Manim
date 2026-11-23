import { describe, it, expect, vi, afterEach } from 'vitest'
import { RoomServiceClient } from 'livekit-server-sdk'
import { handleKnock, handleKnockStatus, handleKnockUpdate } from './core.mjs'
import { claimKey } from './seat.mjs'

/**
 * LiveKit unreachable: nothing listens on port 1, so every RoomService call fails
 * at once. Before, the knock's reads swallowed that and saw "no flags, nobody
 * here": the lock, the invite secret, the waiting room and the removed list all
 * read as off, and whoever knocked was let in (or made host). Every path that
 * gates entry now answers busy instead; the client retries busy.
 */
const env = {
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-for-hmac',
  VITE_LIVEKIT_URL: 'ws://127.0.0.1:1',
}
const ROOM = 'locked-room'

describe('a knock that cannot read the room fails closed', () => {
  afterEach(() => vi.restoreAllMocks())

  it('knock into a live call whose flags read fails: busy, not let in past the lock', async () => {
    // The call is running (the host is in it) and LOCKED, but this one flags read
    // fails. Read as {}, the lock was off and this guest got a token.
    vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockRejectedValue(new Error('twirp error: unavailable'))
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockResolvedValue([{ identity: 'Host#h1', joinedAt: 1n }])
    const r = await handleKnock(env, { room: ROOM, name: 'Kofi', deviceId: 'dev-kofi' })
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ code: 'busy' })
    expect(r.body.token).toBeUndefined()
  })

  it('knock whose participant lookup fails: busy, so a live guest’s identity can’t skip its seat key', async () => {
    vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue([{ metadata: JSON.stringify({ hostId: 'Host#h1' }) }])
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockRejectedValue(new Error('twirp error: unavailable'))
    const r = await handleKnock(env, { room: ROOM, name: 'Ama', deviceId: 'dev-ama' })
    expect(r.status).toBe(503)
    expect(r.body.token).toBeUndefined()
  })

  it('knock with LiveKit down entirely: busy, never a token', async () => {
    const r = await handleKnock(env, { room: ROOM, name: 'Kofi', deviceId: 'dev-kofi', secret: undefined })
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ code: 'busy' })
    expect(r.body.token).toBeUndefined()
  })

  it('knock-status: busy (keep waiting), not "expired"', async () => {
    const claim = await claimKey(env.LIVEKIT_API_SECRET, ROOM, 'req1')
    const r = await handleKnockStatus(env, { room: ROOM, requestId: 'req1', claim })
    expect(r.status).toBe(503)
    expect(r.body.status).toBeUndefined()
  })

  it('knock-update: busy, not "you’re no longer waiting"', async () => {
    const claim = await claimKey(env.LIVEKIT_API_SECRET, ROOM, 'req1')
    const r = await handleKnockUpdate(env, { room: ROOM, requestId: 'req1', claim, note: 'hi' })
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ code: 'busy' })
  })
})

describe('a room that does not exist yet is empty, not unreadable', () => {
  afterEach(() => vi.restoreAllMocks())

  // LiveKit Cloud answers a lookup on a room nobody has opened (a brand-new
  // meeting, or an old one whose room was reaped) with 404 not_found, where a
  // self-hosted server answers []. Read as a failure, the first person into every
  // room got "busy" forever.
  const notFound = () => Object.assign(new Error('requested room does not exist'), { status: 404, code: 'not_found' })

  it('first arrival into a room LiveKit Cloud says does not exist: claims host and gets a token', async () => {
    let meta = null
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockRejectedValue(notFound())
    vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockImplementation(async () =>
      meta == null ? [] : [{ name: ROOM, metadata: meta }],
    )
    vi.spyOn(RoomServiceClient.prototype, 'createRoom').mockImplementation(async (o) => {
      meta = o.metadata
      return { name: ROOM, metadata: meta }
    })
    vi.spyOn(RoomServiceClient.prototype, 'updateRoomMetadata').mockImplementation(async (_r, m) => {
      meta = m
      return { name: ROOM, metadata: m }
    })
    const r = await handleKnock(env, { room: ROOM, name: 'Bismark', deviceId: 'dev-b', host: true })
    expect(r.status).toBe(200)
    expect(r.body.token).toBeTruthy()
    expect(r.body.host).toBe(true)
  })

  it('a 404 from the flags read is also "no room", not busy', async () => {
    vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockRejectedValueOnce(notFound())
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockRejectedValue(notFound())
    vi.spyOn(RoomServiceClient.prototype, 'createRoom').mockResolvedValue({ name: ROOM })
    let meta = ''
    vi.spyOn(RoomServiceClient.prototype, 'updateRoomMetadata').mockImplementation(async (_r, m) => {
      meta = m
      return {}
    })
    RoomServiceClient.prototype.listRooms.mockImplementation(async () => [{ name: ROOM, metadata: meta }])
    const r = await handleKnock(env, { room: ROOM, name: 'Bismark', deviceId: 'dev-b', host: true })
    expect(r.status).toBe(200)
    expect(r.body.token).toBeTruthy()
  })
})
