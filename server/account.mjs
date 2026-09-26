/**
 * Account claims: proof, checkable by any participant, that a seat in a call
 * belongs to a given signed-in account.
 *
 * Your phone and your laptop in the same call are two identities
 * (`name#deviceId`), and chat drew them as two people. What ties them together is
 * the `userId` in participant metadata, but tokens grant canUpdateOwnMetadata
 * (raise-hand rides attributes), so any participant can rewrite theirs to your
 * userId, which they can read off the roster. Believing it would put a stranger's
 * words on your side of the chat, in your colour.
 *
 * So the server signs the pair at mint: Ed25519 over (room, identity, userId),
 * with a key derived from the LiveKit API secret (stateless, like seat keys). The
 * public half rides in every token's metadata too. A client takes the public key
 * from ITS OWN metadata (its own token, which nobody else can change) and checks
 * the other seat's signature with it. A copied signature fails, because it names
 * the identity it was minted for.
 */

const te = new TextEncoder()
// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const PKCS8_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]

const cache = new Map()

function signingKey(secret) {
  const hit = cache.get(secret)
  if (hit) return hit
  const made = (async () => {
    const mac = await crypto.subtle.importKey('raw', te.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const seed = new Uint8Array(await crypto.subtle.sign('HMAC', mac, te.encode('manim account claim v1')))
    const priv = await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8_PREFIX, ...seed]), { name: 'Ed25519' }, true, ['sign'])
    const { x } = await crypto.subtle.exportKey('jwk', priv)
    return { priv, publicKey: x }
  })()
  cache.set(secret, made)
  return made
}

function b64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What is signed. The client builds the same string (lib/sameAccount). */
export function claimMessage(room, identity, userId) {
  return `acct1\n${room}\n${identity}\n${userId}`
}

/**
 * `{ ak, as }` for a token's metadata: the server's public key and the signature
 * for this seat. Empty for a guest (no account, nothing to tie together) or when
 * the runtime can't do Ed25519 (the client then simply keeps devices apart).
 */
export async function accountClaim(secret, room, identity, userId) {
  if (!secret || !userId) return {}
  try {
    const { priv, publicKey } = await signingKey(secret)
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, te.encode(claimMessage(room, identity, userId))))
    return { ak: publicKey, as: b64url(sig) }
  } catch {
    return {}
  }
}
