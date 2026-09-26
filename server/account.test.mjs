import { test, expect } from 'vitest'
import { accountClaim, claimMessage } from './account.mjs'

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

async function verify(ak, as, room, identity, userId) {
  const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: ak }, { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify('Ed25519', key, b64(as), new TextEncoder().encode(claimMessage(room, identity, userId)))
}

test('a claim verifies for its own seat and no other', async () => {
  const c = await accountClaim('s3cret', 'room-1', 'Ada#dev1', 'user-1')
  expect(c.ak && c.as).toBeTruthy()
  expect(await verify(c.ak, c.as, 'room-1', 'Ada#dev1', 'user-1')).toBe(true)
  expect(await verify(c.ak, c.as, 'room-1', 'Eve#dev9', 'user-1')).toBe(false)
  expect(await verify(c.ak, c.as, 'room-2', 'Ada#dev1', 'user-1')).toBe(false)
  expect(await verify(c.ak, c.as, 'room-1', 'Ada#dev1', 'user-2')).toBe(false)
})

test('the public key is stable per secret and differs across secrets', async () => {
  const a = await accountClaim('s3cret', 'r', 'A#1', 'u')
  const b = await accountClaim('s3cret', 'r', 'B#2', 'u')
  const c = await accountClaim('other', 'r', 'A#1', 'u')
  expect(a.ak).toBe(b.ak)
  expect(a.ak).not.toBe(c.ak)
})

test('a guest gets no claim', async () => {
  expect(await accountClaim('s3cret', 'r', 'A#1', '')).toEqual({})
})
