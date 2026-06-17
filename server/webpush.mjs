/*
  Minimal Web Push sender — VAPID auth, PAYLOAD-LESS ("tickle") pushes. Uses only
  Web-standard crypto (crypto.subtle) + fetch, so it runs on Cloudflare Workers and
  Node 18+. We deliberately send no encrypted body: the service worker shows a
  generic "incoming call" notification and the app fills in who/where once opened
  (the Realtime channel reconnects on focus). This sidesteps the RFC 8291
  aes128gcm payload-encryption path entirely — far less crypto surface to get wrong.
*/

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0
  const bin = atob(s + '='.repeat(pad))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function strToB64url(s) {
  return bytesToB64url(new TextEncoder().encode(s))
}

/** Import the VAPID P-256 private key (base64url raw scalar `d` + the public point
 *  for the x/y coords) as an ECDSA signing key via JWK. */
async function importVapidKey(privateB64url, publicB64url) {
  const pub = b64urlToBytes(publicB64url) // 65 bytes: 0x04 || X(32) || Y(32)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateB64url,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

/** VAPID `Authorization` header value scoped to one push endpoint's origin. */
async function vapidAuthHeader(env, endpoint) {
  const aud = new URL(endpoint).origin
  const header = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = strToB64url(
    JSON.stringify({
      aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: env.VAPID_SUBJECT || 'mailto:admin@manim.app',
    }),
  )
  const signingInput = `${header}.${payload}`
  const key = await importVapidKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY)
  // ECDSA P-256/SHA-256 → raw r||s (64 bytes), which is exactly JWT ES256 form.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
}

/** True when the VAPID keypair is configured. */
export function pushConfigured(env) {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY)
}

/** Send one payload-less push. Returns the HTTP status (201 ok; 404/410 = gone). */
export async function sendPush(env, endpoint) {
  if (!pushConfigured(env)) return 0
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(env, endpoint),
      TTL: '120',
      Urgency: 'high',
      'Content-Length': '0',
    },
  })
  return res.status
}
