import type { DeviceKey } from '@/lib/sealedSecrets'

/**
 * What this browser remembers about each contact's devices, so a quiet change
 * doesn't go unnoticed.
 *
 * A ring's secrets are sealed to whatever device keys the server hands back for
 * the person you're calling (features/calls/deviceKeys). The server is trusted
 * for that list, so a device slipped into it (someone signed in to their
 * account, or the server itself) would be sealed to as well, and could open the
 * call. Messaging apps answer this with trust on first use: remember each key
 * the first time you see it, and speak up when it changes (WhatsApp's "security
 * code changed", Signal's safety numbers).
 *
 * So: the first ring to a contact just remembers their devices. After that, a
 * device we've never seen is a NEW device (common and usually innocent: a new
 * phone, a new browser), which gets a notice; a device we know whose key is now
 * DIFFERENT is the suspicious case, and the caller is asked before it's rung.
 *
 * Kept per signed-in account (two people sharing a browser don't share what
 * they trust) in localStorage, keyed by a short fingerprint of each public key.
 * Never sent anywhere.
 */

const KEY = 'manim-device-pins'
type Pins = Record<string, Record<string, Record<string, string>>> // owner → contact → device → fingerprint

function load(): Pins {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? (v as Pins) : {}
  } catch {
    return {}
  }
}

function store(p: Pins) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage full or blocked: we just can't remember, which only means no warnings */
  }
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A short, stable name for a public key: 128 bits of SHA-256 over its curve point. */
export async function fingerprint(jwk: JsonWebKey): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.crv}.${jwk.x}.${jwk.y}`))
  return b64url(new Uint8Array(h).slice(0, 16))
}

export interface PinCheck {
  /** Nothing remembered for this contact yet: nothing to compare against. */
  first: boolean
  /** Devices we've never seen for them. */
  added: string[]
  /** Devices we know whose key is now different. */
  changed: string[]
  /** Save what was seen, as trusted from now on. */
  accept: () => void
}

/** Compare a contact's devices, as the server lists them now, with what we remember. */
export async function checkDevices(owner: string, contact: string, devices: DeviceKey[]): Promise<PinCheck> {
  const known = load()[owner]?.[contact] ?? {}
  const seen: Record<string, string> = {}
  for (const d of devices) seen[d.deviceId] = await fingerprint(d.publicJwk)
  const first = Object.keys(known).length === 0
  const added = first ? [] : Object.keys(seen).filter((id) => !(id in known))
  const changed = Object.keys(seen).filter((id) => id in known && known[id] !== seen[id])
  return {
    first,
    added,
    changed,
    accept: () => {
      const all = load()
      // Merge: a device missing from today's list (signed out, or past the
      // server's 10-device cap) stays remembered, so its return isn't "new".
      all[owner] = { ...all[owner], [contact]: { ...all[owner]?.[contact], ...seen } }
      store(all)
    },
  }
}
