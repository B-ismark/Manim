import { describe, it, expect } from 'vitest'
import { isSealed, newDeviceKeyPair, openSealed, sealedFor, sealFor } from './sealedSecrets'

describe('sealedSecrets', () => {
  it('only the addressed devices can open it, and each gets the secrets back', async () => {
    const a = await newDeviceKeyPair()
    const b = await newDeviceKeyPair()
    const c = await newDeviceKeyPair()
    const sealed = await sealFor(
      [
        { deviceId: 'dev-a', publicJwk: a.publicJwk },
        { deviceId: 'dev-b', publicJwk: b.publicJwk },
      ],
      { secret: 'join-123', e2ee: 'key-xyz' },
    )
    expect(isSealed(sealed)).toBe(true)
    expect(sealed).not.toContain('key-xyz')
    expect(sealed).not.toContain('join-123')
    expect(await openSealed(sealed!, 'dev-a', a.privateKey, a.publicJwk)).toEqual({ secret: 'join-123', e2ee: 'key-xyz' })
    expect(await openSealed(sealed!, 'dev-b', b.privateKey, b.publicJwk)).toEqual({ secret: 'join-123', e2ee: 'key-xyz' })
    // Not addressed to it, or the wrong key for an address it claims.
    expect(await openSealed(sealed!, 'dev-c', c.privateKey, c.publicJwk)).toBeNull()
    expect(await openSealed(sealed!, 'dev-a', c.privateKey, c.publicJwk)).toBeNull()
    expect(sealedFor(sealed!, 'dev-a')).toBe(true)
    expect(sealedFor(sealed!, 'dev-c')).toBe(false)
  })

  it('seals nothing without devices or secrets, and refuses junk', async () => {
    const a = await newDeviceKeyPair()
    expect(await sealFor([], { e2ee: 'k' })).toBeNull()
    expect(await sealFor([{ deviceId: 'd', publicJwk: a.publicJwk }], {})).toBeNull()
    expect(await sealFor([{ deviceId: 'd', publicJwk: { kty: 'EC', x: 'bad', y: 'bad' } }], { e2ee: 'k' })).toBeNull()
    expect(await openSealed('sealed1:!!', 'd', a.privateKey, a.publicJwk)).toBeNull()
    expect(await openSealed('plain-key', 'd', a.privateKey, a.publicJwk)).toBeNull()
  })

  it('keeps an absent half absent', async () => {
    const a = await newDeviceKeyPair()
    const sealed = await sealFor([{ deviceId: 'd', publicJwk: a.publicJwk }], { e2ee: 'only-key' })
    expect(await openSealed(sealed!, 'd', a.privateKey, a.publicJwk)).toEqual({ secret: undefined, e2ee: 'only-key' })
  })
})
