/**
 * Seat keys: proof that a join request comes from the browser that already holds
 * a seat, rather than from someone who has merely READ that seat's identity.
 *
 * A participant's identity is `${name}#${deviceId}`, both halves supplied by the
 * client, and identities are public — every participant sees the whole roster, and
 * the host's is written into room metadata as `hostId`. Knock grants privileges on
 * identity alone (reclaiming host, stepping back into a live seat, skipping the
 * waiting room as a previously-admitted guest), so without a second factor anyone
 * who had been in a call could POST the host's identity and walk out with a
 * `roomAdmin` token — and connecting with it evicts the real host, since LiveKit
 * drops the older session under a duplicate identity.
 *
 * The key is an HMAC of (room, identity) under the LiveKit API secret: stateless
 * (nothing new to store or expire), unforgeable without the secret, and handed only
 * to the client whose request produced that identity. `claimKey` does the same
 * for a waiting-room request id, which also sits in public room metadata and
 * otherwise lets anyone who reads it poll out the admitted guest's token.
 */

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string compare, so a probe can't learn a key byte by byte. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function seatKey(secret, room, identity) {
  return hmacHex(secret, `seat\n${room}\n${identity}`)
}

export async function seatKeyValid(secret, room, identity, presented) {
  if (!secret || !presented) return false
  return safeEqual(presented, await seatKey(secret, room, identity))
}

export function claimKey(secret, room, requestId) {
  return hmacHex(secret, `claim\n${room}\n${requestId}`)
}

export async function claimKeyValid(secret, room, requestId, presented) {
  if (!secret || !presented) return false
  return safeEqual(presented, await claimKey(secret, room, requestId))
}
