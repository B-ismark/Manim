/**
 * Room links carry their security material in the URL #fragment, never the path:
 *
 *   /r/<slug>#k=<joinSecret>&e=<e2eeKey>
 *
 *  - slug — routing/display only (low-entropy, memorable). NOT a credential.
 *  - k    — high-entropy join secret. The server enforces it (knock fails without
 *           it once a room records its hash), so the LINK is the bearer token, not
 *           the guessable slug. Closes room enumeration.
 *  - e    — end-to-end-encryption key. A strong random key beats a typed passphrase
 *           (no weak human choice, nothing to mistype). Media-only; the key never
 *           reaches the server (a #fragment is not sent in the request/Referer).
 *
 * Putting both in the fragment means every share path that copies the current URL
 * (copy-link, native share, email invite) carries them for free. App-internal
 * navigations that DON'T have the URL in hand (merge, cross-device quick-join,
 * ringing) must thread these secrets through explicitly.
 *
 * KNOWN LIMITATION — no E2EE re-key on membership change (audit S4b). The media key
 * is fixed for the room's lifetime; a participant who leaves (or is removed) retains
 * it and could decode subsequent media if they captured ciphertext or rejoin with
 * the link. Excluding them cryptographically needs a fresh key delivered ONLY to
 * remaining members — which the SFU/data-channel can't carry without leaking it to
 * the server E2EE defends against, so it requires a per-peer key-exchange protocol
 * (e.g. X25519). Deliberately deferred: the operational controls (link gate +
 * host-remove) cover the common case, and a hand-rolled re-key risks breaking E2EE
 * outright. Build remove-only re-key (not every leave) if the threat model needs it.
 */
export interface RoomSecrets {
  /** Join secret (#k) — server-enforced room access credential. */
  secret?: string
  /** End-to-end-encryption key (#e) — media key, never sent to the server. */
  e2ee?: string
}

/**
 * Link epoch — the beta "kill switch" for old invite links. Every freshly minted
 * join secret is prefixed `<epoch>.<random>`; the server (see LINK_EPOCH in
 * server/core.mjs) rejects any knock whose secret carries a different — or no —
 * epoch. Shipping the check at all invalidates every PRE-epoch link (their secrets
 * have no prefix); bumping this value + redeploying invalidates the current crop
 * too. `.` is the separator: a base64url secret never contains one, so the split is
 * unambiguous. Must stay in sync with the server's default LINK_EPOCH.
 */
export const LINK_EPOCH = '1'

/** CSPRNG URL-safe token. 16 bytes ≈ 128 bits — well past brute-force. */
export function randomSecret(bytes = 16): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes))
  let s = ''
  for (const b of a) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A fresh secret + E2EE key for a newly-created room. The join secret carries the
 *  current link epoch so the server can reject pre-cutover links (the e2ee key is
 *  media-only, never sent to the server, so it needs no epoch). */
export function newRoomSecrets(): Required<RoomSecrets> {
  return { secret: `${LINK_EPOCH}.${randomSecret()}`, e2ee: randomSecret() }
}

/** Parse a location hash (`#k=…&e=…`) into its secrets. */
export function parseRoomHash(hash: string): RoomSecrets {
  const p = new URLSearchParams((hash || '').replace(/^#/, ''))
  return { secret: p.get('k') || undefined, e2ee: p.get('e') || undefined }
}

/** Build the `#k=…&e=…` fragment (empty string when there's nothing to carry). */
export function roomHash({ secret, e2ee }: RoomSecrets): string {
  const p = new URLSearchParams()
  if (secret) p.set('k', secret)
  if (e2ee) p.set('e', e2ee)
  const s = p.toString()
  return s ? `#${s}` : ''
}

/**
 * A react-router navigation target for a room, carrying any secrets in the hash.
 * Use the object form (not a template string) so the hash isn't percent-encoded
 * into the path.
 */
export function roomTo(slug: string, secrets: RoomSecrets = {}) {
  return { pathname: `/r/${encodeURIComponent(slug)}`, hash: roomHash(secrets) }
}
