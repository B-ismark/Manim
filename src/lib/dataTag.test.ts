import { describe, it, expect } from 'vitest'
import { Encryption_Type, type Room } from 'livekit-client'
import { openData, sealData, setDataTagKey } from './dataTag'

function encryptedRoom(passphrase: string): Room {
  const keyProvider = {}
  setDataTagKey(keyProvider, passphrase)
  return { options: { encryption: { keyProvider } } } as unknown as Room
}
const plainRoom = { options: {} } as unknown as Room
const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)
const NONE = Encryption_Type.NONE

describe('dataTag', () => {
  it('a packet sealed with the call key opens, even though livekit flags it NONE', async () => {
    const room = encryptedRoom('k1')
    const sealed = await sealData(room, 'mn.pin', bytes('{"pinned":true}'))
    expect(text(await openData(room, 'mn.pin', sealed, true, NONE))).toBe('{"pinned":true}')
  })

  it('drops a clear packet with no tag, a wrong key, or a different topic', async () => {
    const room = encryptedRoom('k1')
    expect(await openData(room, 'mn.pin', bytes('forged'), true, NONE)).toBeNull()
    const otherKey = await sealData(encryptedRoom('k2'), 'mn.pin', bytes('x'))
    expect(await openData(room, 'mn.pin', otherKey, true, NONE)).toBeNull()
    const moved = await sealData(room, 'mn.chat-history', bytes('x'))
    expect(await openData(room, 'mn.pin', moved, true, NONE)).toBeNull()
  })

  it('drops a tampered payload', async () => {
    const room = encryptedRoom('k1')
    const sealed = await sealData(room, 'mn.pin', bytes('abc'))
    sealed[sealed.length - 1] ^= 1
    expect(await openData(room, 'mn.pin', sealed, true, NONE)).toBeNull()
  })

  it('believes an honest GCM flag, and the server’s own messages', async () => {
    const room = encryptedRoom('k1')
    expect(text(await openData(room, 't', bytes('ok'), true, Encryption_Type.GCM))).toBe('ok')
    expect(text(await openData(room, 't', bytes('server'), false, NONE))).toBe('server')
  })

  it('leaves an unencrypted call untouched', async () => {
    const sealed = await sealData(plainRoom, 't', bytes('plain'))
    expect(text(sealed)).toBe('plain')
    expect(text(await openData(plainRoom, 't', sealed, true, NONE))).toBe('plain')
  })
})
