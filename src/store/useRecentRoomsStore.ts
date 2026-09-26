import { create } from 'zustand'

/**
 * A meeting the user was recently in, for one-tap rejoin from the home page. The
 * join secret + E2EE key are stored alongside the slug so rejoin reconstructs the
 * full invite link. Locally the secrets sit in the clear — the same #fragment is
 * already in the browser's history, so it's no new exposure on the user's own
 * device. A signed-in account also syncs the list across its devices, with the
 * secrets sealed to those devices (features/calls/recentSync).
 */
export interface RecentRoom {
  slug: string
  /** Pretty display name (prettyRoom of the slug at record time). */
  name: string
  /** When the user was last in this room (ms epoch). */
  ts: number
  /** Invite-link secrets, so rejoin passes the join gate / keys the media. */
  secret?: string
  e2ee?: string
}

const KEY = 'mn.recentRooms'
const MAX = 6
// Recent calls self-expire after 30 days of no rejoin (WhatsApp/iOS norm: a bounded
// recents list, oldest dropped). Each rejoin refreshes `ts`, so an active call's slug
// keeps its place; a link no one has touched in a month falls off on the next load.
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function load(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const fresh = Date.now() - TTL_MS
    const rooms = arr.filter(
      (r): r is RecentRoom =>
        !!r &&
        typeof (r as RecentRoom).slug === 'string' &&
        typeof (r as RecentRoom).ts === 'number' &&
        (r as RecentRoom).ts >= fresh,
    )
    // Persist the prune so expired entries don't linger in storage.
    if (rooms.length !== arr.length) save(rooms)
    return rooms
  } catch {
    return []
  }
}

function save(rooms: RecentRoom[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rooms))
  } catch {
    /* storage blocked / full — keep in memory only */
  }
}

interface State {
  rooms: RecentRoom[]
  /** Record (or refresh) a room — most-recent first, deduped by slug, capped. */
  record: (room: RecentRoom) => void
  remove: (slug: string) => void
  /**
   * Fold in the account's list from another device (features/calls/recentSync).
   * Newest timestamp wins per room; secrets from either side are kept when the
   * other side has none, so a row this device couldn't open never erases a link
   * it already had.
   */
  merge: (remote: RecentRoom[]) => void
}

export const useRecentRoomsStore = create<State>((set) => ({
  rooms: load(),
  record: (room) =>
    set((s) => {
      const next = [room, ...s.rooms.filter((r) => r.slug !== room.slug)].slice(0, MAX)
      save(next)
      return { rooms: next }
    }),
  remove: (slug) =>
    set((s) => {
      const next = s.rooms.filter((r) => r.slug !== slug)
      save(next)
      return { rooms: next }
    }),
  merge: (remote) =>
    set((s) => {
      const fresh = Date.now() - TTL_MS
      const bySlug = new Map(s.rooms.map((r) => [r.slug, r]))
      for (const r of remote) {
        if (r.ts < fresh) continue
        const mine = bySlug.get(r.slug)
        if (!mine) {
          bySlug.set(r.slug, r)
          continue
        }
        const newer = r.ts > mine.ts ? r : mine
        const other = newer === r ? mine : r
        bySlug.set(r.slug, {
          ...newer,
          secret: newer.secret ?? other.secret,
          e2ee: newer.e2ee ?? other.e2ee,
        })
      }
      const next = [...bySlug.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX)
      save(next)
      return { rooms: next }
    }),
}))
