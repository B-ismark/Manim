import { test, expect } from '@playwright/test'
import { uniqueRoom } from './helpers'

/**
 * Seat keys (server/seat.mjs), exercised against the real knock endpoint.
 *
 * The hole this closes: a participant's identity (`name#deviceId`) is public — the
 * roster shows it, and the host's is `hostId` in room metadata — and knock used to
 * grant host on identity alone. Anyone who had seen the host's identity could POST
 * it and get a roomAdmin token. Needs a real LiveKit (the host record lives in room
 * metadata), so it runs wherever the rest of the suite does, e2e-local included.
 */
test.describe('Seat keys', () => {
  test('the host seat is reclaimable with its key, and only with its key', async ({ request }) => {
    const room = uniqueRoom('seat')
    const knock = (data: Record<string, unknown>) => request.post('/api/knock', { data: { room, ...data } })

    // First in claims host, and gets back the key to that seat.
    const first = await knock({ name: 'Ama', deviceId: 'dev-host' })
    expect(first.status()).toBe(200)
    const claimed = await first.json()
    expect(claimed.host).toBe(true)
    expect(claimed.seat).toMatch(/^[0-9a-f]{64}$/)

    // Someone who knows the host's identity but not the key is turned away — not
    // handed a plain token, which would still collide with the host's session.
    const spoof = await knock({ name: 'Ama', deviceId: 'dev-host' })
    expect(spoof.status()).toBe(409)
    expect((await spoof.json()).code).toBe('seat_taken')
    const forged = await knock({ name: 'Ama', deviceId: 'dev-host', seat: '0'.repeat(64) })
    expect(forged.status()).toBe(409)

    // The real host, rejoining with the key, is host again.
    const back = await knock({ name: 'Ama', deviceId: 'dev-host', seat: claimed.seat })
    expect(back.status()).toBe(200)
    expect((await back.json()).host).toBe(true)

    // A different device is a different seat: it joins, but not as host.
    const guest = await knock({ name: 'Ama', deviceId: 'dev-guest' })
    expect(guest.status()).toBe(200)
    expect((await guest.json()).host).toBe(false)
  })

  test('knock refuses names that would break the identity or the queue', async ({ request }) => {
    const room = uniqueRoom('seat')
    const knock = (name: string) => request.post('/api/knock', { data: { room, name, deviceId: 'd' } })
    expect((await knock('Bob#2')).status()).toBe(400)
    expect((await knock('x'.repeat(65))).status()).toBe(400)
    expect((await knock('   ')).status()).toBe(400)
  })

  test('a waiting-room request can only be polled with its claim key', async ({ request }) => {
    const room = uniqueRoom('seat')
    // An unknown request with no claim gets nothing — in particular, no token.
    const res = await request.get(`/api/knock-status?room=${room}&requestId=anything`)
    expect(res.status()).toBe(403)
    expect((await res.json()).token).toBeUndefined()
  })
})
