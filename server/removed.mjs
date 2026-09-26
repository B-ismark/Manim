/**
 * Who the host has removed from a room, so "Remove from call" sticks.
 *
 * Removing someone used to disconnect them and nothing more: they could knock
 * straight back in with the same link. The room now remembers them, checked at
 * knock, by device id (the part of the identity after `#`), which covers guests
 * and survives a name change. The core passes no account id: the only one at
 * hand when removing is the target's live participant metadata, which the client
 * can rewrite, so trusting it would let someone get another person's account
 * banned. (The helpers still accept one, for a server-recorded id later.)
 * Someone determined can still clear site data or switch browsers; locking the
 * call covers that. Keys are hashed before they go into room metadata, which
 * every participant can read.
 */

/** At most this many removals are remembered per room (metadata is size-capped). */
export const MAX_REMOVED = 50

async function h(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`manim-removed:${s}`))
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The entry to store for a removed participant, or null if there's nothing to key on. */
export async function removedEntry(identity, userId) {
  const device = String(identity || '').split('#')[1] || ''
  // `web` is the shared fallback for a client that sent no device id: banning it
  // would ban every such client.
  const d = device && device !== 'web' ? await h(`d:${device}`) : ''
  const u = userId ? await h(`u:${userId}`) : ''
  return d || u ? { d, u } : null
}

/** `removed` with `entry` appended, oldest dropped past the cap. */
export function withRemoved(removed, entry) {
  const list = Array.isArray(removed) ? removed : []
  return [...list, entry].slice(-MAX_REMOVED)
}

/** Whether a knock from this device / account matches a removal. */
export async function wasRemoved(removed, deviceId, userId) {
  if (!Array.isArray(removed) || removed.length === 0) return false
  const d = deviceId && deviceId !== 'web' ? await h(`d:${deviceId}`) : ''
  const u = userId ? await h(`u:${userId}`) : ''
  return removed.some((e) => e && ((d && e.d === d) || (u && e.u === u)))
}
