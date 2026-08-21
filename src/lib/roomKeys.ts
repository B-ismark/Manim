/**
 * Local memory of a room's link secrets, and the reason the app stopped losing
 * them.
 *
 * An invite link carries everything that makes a room enterable in its #fragment
 * (`#k=<joinSecret>&e=<e2eeKey>` — see lib/roomLink). That is a good design and it
 * has one sharp edge: a fragment is the single most fragile part of a URL, because
 * a URL only gets ONE of them and anything that navigates can overwrite it. We were
 * losing it in at least three places, all of which surfaced to the user as the same
 * baffling "This room needs its invite link" on a link they had definitely opened:
 *
 *  1. SIGNING IN FROM A ROOM. `signInWithOAuth`/magic-link pass `redirectTo:
 *     window.location.href`, and the provider comes back appending its own fragment
 *     (`#access_token=…`). One fragment per URL — so the round trip through auth
 *     silently swapped the room's credential for the provider's, and the user landed
 *     signed in and locked out.
 *  2. RE-SHARING FROM A BROKEN TAB. Copy-link, native share and the email invite all
 *     read `window.location.href`. Once (1) had stripped a tab's fragment, everything
 *     that tab shared was a dead link — so ONE person signing in mid-call could hand
 *     out invites that fail for everybody who opens them. That is very likely the
 *     shape of the reports: the link was real, the sender's URL wasn't.
 *  3. The "Rejoin" undo toast, which navigated to `/r/<slug>` with no fragment.
 *
 * So: remember the secrets the first time we see them, put them back when the
 * fragment doesn't have them, and rewrite the address bar so everything downstream
 * that reads `location.href` is carrying a working link again.
 *
 * Storage is the same trade `useRecentRoomsStore` already makes and for the same
 * reason: the identical #fragment is in this browser's history already, so writing
 * it to this browser's localStorage is no new exposure on the user's own device.
 * Nothing here is ever sent anywhere — the E2EE key in particular must never reach a
 * server, and doesn't.
 */
import type { RoomSecrets } from '@/lib/roomLink'

const KEY = 'mn.roomKeys'
/** Match the recents list: a link nobody has touched in a month is not worth keeping. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Bound the map so a heavy user's storage doesn't grow without limit. */
const MAX = 24

interface Entry {
  secret?: string
  e2ee?: string
  ts: number
}

function load(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const fresh = Date.now() - TTL_MS
    const out: Record<string, Entry> = {}
    for (const [slug, v] of Object.entries(parsed as Record<string, Entry>)) {
      if (v && typeof v.ts === 'number' && v.ts >= fresh) out[slug] = v
    }
    return out
  } catch {
    return {}
  }
}

function save(map: Record<string, Entry>) {
  try {
    // Newest first, capped — an old entry falling off is the intended behaviour.
    const trimmed = Object.entries(map)
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    /* storage blocked or full — the link in the URL still works, we just can't heal it */
  }
}

/** Record the secrets an invite link arrived with. */
export function rememberRoomSecrets(slug: string, secrets: RoomSecrets): void {
  if (!slug || (!secrets.secret && !secrets.e2ee)) return
  const map = load()
  map[slug] = { secret: secrets.secret, e2ee: secrets.e2ee, ts: Date.now() }
  save(map)
}

/** What we know about this room's link, if anything. */
export function recallRoomSecrets(slug: string): RoomSecrets {
  const e = load()[slug]
  return e ? { secret: e.secret, e2ee: e.e2ee } : {}
}

/**
 * Forget a room's secrets — call this when the server REJECTS them.
 *
 * Without it a stale entry is worse than none: the user opens a fresh, valid link,
 * we'd have nothing to fall back to anyway (a link that carries secrets always
 * wins), but a superseded room would keep failing with a remembered credential and
 * no way for the user to tell why. Dropping it on rejection keeps the memory
 * self-correcting.
 */
export function forgetRoomSecrets(slug: string): void {
  const map = load()
  if (!(slug in map)) return
  delete map[slug]
  save(map)
}

/**
 * The secrets to join `slug` with: the link's if it carries any, otherwise whatever
 * we remembered from the last time it did.
 *
 * A link that carries ANY secret material is trusted WHOLESALE — we never merge a
 * remembered `e2ee` into a link that only had `k`. Merging looks helpful and is a
 * media-breaking bug: a room deliberately shared without an E2EE key would silently
 * acquire one from a stale entry, and the joiner would publish ciphertext nobody
 * else in the room could decode.
 */
export function resolveRoomSecrets(slug: string, fromLink: RoomSecrets): RoomSecrets {
  if (fromLink.secret || fromLink.e2ee) {
    rememberRoomSecrets(slug, fromLink)
    return fromLink
  }
  return recallRoomSecrets(slug)
}

/**
 * Does this fragment belong to the auth round-trip rather than to us?
 *
 * Supabase parks `#access_token=…` / `#error=…` there and consumes it at startup.
 * Restoring the room's own fragment over the top of one of those, before it has
 * been read, would trade one lost credential for another — so the restore waits a
 * beat and only ever replaces a fragment that has nothing of theirs in it.
 */
export function isAuthFragment(hash: string): boolean {
  const p = new URLSearchParams((hash || '').replace(/^#/, ''))
  return ['access_token', 'refresh_token', 'provider_token', 'code', 'error', 'error_description'].some((k) =>
    p.has(k),
  )
}
