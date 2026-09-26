import type { RoomSecrets } from '@/lib/roomLink'

/**
 * A room's secrets (join secret + E2EE key) sealed so only chosen DEVICES can read
 * them.
 *
 * Ringing a contact and showing your own other devices which call you're in both
 * used to hand the key to Supabase in the clear: a ring's payload sits in its
 * Realtime table for up to three days. Now each signed-in browser holds an ECDH
 * P-256 keypair (lib/deviceKey: the private half never leaves the browser and
 * can't be exported), publishes the public half, and a sender encrypts the
 * secrets once per recipient device: an ephemeral ECDH exchange with that
 * device's key, HKDF-SHA-256 to an AES-GCM key, the recipient's device id as
 * associated data. Supabase then only ever carries ciphertext.
 *
 * The sealed form travels in the ring's existing `e2ee` string, prefixed so an
 * opener can tell it from a raw key; `secret` travels empty. No database function
 * had to change shape for it.
 */

export const SEALED_PREFIX = 'sealed1:'

export interface DeviceKey {
  deviceId: string
  publicJwk: JsonWebKey
}

interface Entry {
  /** recipient device id */
  d: string
  /** sender's ephemeral public key (x, y) */
  x: string
  y: string
  iv: string
  ct: string
}

const te = new TextEncoder()
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function aesKey(priv: CryptoKey, pub: CryptoKey, deviceId: string): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(`manim-sealed-v1:${deviceId}`) },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

const importPublic = (jwk: JsonWebKey) =>
  crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, ECDH, false, [])

export function isSealed(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(SEALED_PREFIX)
}

/** Seal `secrets` for each device. Null when there is nothing to seal or no device. */
export async function sealFor(devices: DeviceKey[], secrets: RoomSecrets): Promise<string | null> {
  if (!devices.length || (!secrets.secret && !secrets.e2ee)) return null
  const body = te.encode(JSON.stringify({ k: secrets.secret ?? null, e: secrets.e2ee ?? null }))
  const entries: Entry[] = []
  for (const dev of devices) {
    try {
      const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
      const key = await aesKey(eph.privateKey, await importPublic(dev.publicJwk), dev.deviceId)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(dev.deviceId) }, key, body),
      )
      const epk = await crypto.subtle.exportKey('jwk', eph.publicKey)
      entries.push({ d: dev.deviceId, x: epk.x!, y: epk.y!, iv: b64(iv), ct: b64(ct) })
    } catch {
      /* a malformed published key — skip that device, seal for the rest */
    }
  }
  if (!entries.length) return null
  return SEALED_PREFIX + b64(te.encode(JSON.stringify(entries)))
}

/** Open a sealed value for this device. Null when it isn't addressed to it or fails. */
export async function openSealed(sealed: string, deviceId: string, privateKey: CryptoKey): Promise<RoomSecrets | null> {
  if (!isSealed(sealed)) return null
  try {
    const entries = JSON.parse(new TextDecoder().decode(unb64(sealed.slice(SEALED_PREFIX.length)))) as Entry[]
    const mine = Array.isArray(entries) ? entries.find((e) => e && e.d === deviceId) : undefined
    if (!mine) return null
    const key = await aesKey(privateKey, await importPublic({ x: mine.x, y: mine.y }), deviceId)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(mine.iv), additionalData: te.encode(deviceId) },
      key,
      unb64(mine.ct),
    )
    const { k, e } = JSON.parse(new TextDecoder().decode(pt)) as { k: string | null; e: string | null }
    return { secret: k ?? undefined, e2ee: e ?? undefined }
  } catch {
    return null
  }
}

/** A fresh device keypair: private half non-extractable. */
export async function newDeviceKeyPair(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { privateKey: pair.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } }
}
