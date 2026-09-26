/**
 * Sealing for the waiting-room queue, which lives in room metadata.
 *
 * Room metadata is readable by everyone in the call, and the queue held each
 * request's name, device id and account id, denied ones included, until the room
 * closed. Nothing on the client reads the queue (the host lists requests through
 * /api/pending), so it is stored encrypted: AES-GCM under a key derived from the
 * LiveKit API secret, which only the server holds. What participants can still
 * see is that a sealed blob exists and roughly how big it is.
 */

const te = new TextEncoder()
const keys = new Map()

async function keyFor(secret) {
  let k = keys.get(secret)
  if (!k) {
    const base = await crypto.subtle.importKey('raw', te.encode(String(secret)), 'HKDF', false, ['deriveKey'])
    k = crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('manim-queue-v1') },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    keys.set(secret, k)
  }
  return k
}

const toB64 = (u8) => btoa(String.fromCharCode(...u8))
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Encrypt any JSON value to a string, bound to `room` so a blob can't be moved. */
export async function seal(secret, room, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: te.encode(String(room)) },
      await keyFor(secret),
      te.encode(JSON.stringify(value)),
    ),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64(out)
}

/** Decrypt a `seal` string; `fallback` for anything missing, tampered or foreign. */
export async function unseal(secret, room, sealed, fallback) {
  if (typeof sealed !== 'string' || !sealed) return fallback
  try {
    const raw = fromB64(sealed)
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: te.encode(String(room)) },
      await keyFor(secret),
      raw.slice(12),
    )
    return JSON.parse(new TextDecoder().decode(pt))
  } catch {
    return fallback
  }
}
