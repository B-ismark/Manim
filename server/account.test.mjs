import { test, expect } from 'vitest'
import { accountClaim, accountPseudonym, claimMessage } from './account.mjs'

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

async function verify(ak, as, room, identity, acct) {
  const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: ak }, { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify('Ed25519', key, b64(as), new TextEncoder().encode(claimMessage(room, identity, acct)))
}

test('a claim verifies for its own seat and no other', async () => {
  const c = await accountClaim('s3cret', 'room-1', 'Ada#dev1', 'user-1')
  expect(c.ak && c.as && c.acct).toBeTruthy()
  const other = await accountPseudonym('s3cret', 'room-1', 'user-2')
  expect(await verify(c.ak, c.as, 'room-1', 'Ada#dev1', c.acct)).toBe(true)
  expect(await verify(c.ak, c.as, 'room-1', 'Eve#dev9', c.acct)).toBe(false)
  expect(await verify(c.ak, c.as, 'room-2', 'Ada#dev1', c.acct)).toBe(false)
  expect(await verify(c.ak, c.as, 'room-1', 'Ada#dev1', other)).toBe(false)
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

test('the pseudonym ties one account within a room and nowhere else', async () => {
  const a = await accountPseudonym('s3cret', 'room-1', 'user-1')
  expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(a).not.toContain('user-1')
  expect(await accountPseudonym('s3cret', 'room-1', 'user-1')).toBe(a)
  expect(await accountPseudonym('s3cret', 'room-2', 'user-1')).not.toBe(a)
  expect(await accountPseudonym('s3cret', 'room-1', 'user-2')).not.toBe(a)
  expect(await accountPseudonym('other', 'room-1', 'user-1')).not.toBe(a)
  expect(await accountPseudonym('s3cret', 'room-1', '')).toBe('')
})
