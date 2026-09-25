/**
 * This browser's seat keys — the server's proof that a knock comes from the client
 * that already holds a seat (see server/seat.mjs for why identity alone isn't).
 *
 * Keyed by room + identity, because an identity is `name#deviceId` and renaming
 * yourself is a new seat. Same storage trade as lib/roomKeys: bounded, TTL'd,
 * and a key only ever unlocks a seat this browser was already given. Losing one
 * (cleared storage, private window) costs nothing but a fresh seat: the device id
 * is lost with it, so the identity changes too.
 */
const KEY = 'mn.seats'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX = 48

type Store = Record<string, { seat: string; ts: number }>

const slot = (room: string, identity: string) => `${room}\n${identity}`

function load(): Store {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

export function seatFor(room: string, identity: string): string | undefined {
  const e = load()[slot(room, identity)]
  return e && typeof e.seat === 'string' && Date.now() - e.ts < TTL_MS ? e.seat : undefined
}

export function rememberSeat(room: string, identity: string | undefined, seat: string | undefined): void {
  if (!identity || !seat) return
  try {
    const fresh = Date.now() - TTL_MS
    const here = slot(room, identity)
    // This slot's old entry is left out, not merged: spread after the fresh one it
    // won, so a seat in daily use still expired 30 days after it was first saved.
    const kept = Object.entries(load())
      .filter(([k, v]) => k !== here && v && typeof v.ts === 'number' && v.ts >= fresh)
      .sort((a, b) => b[1].ts - a[1].ts)
      .slice(0, MAX - 1)
    localStorage.setItem(KEY, JSON.stringify({ [here]: { seat, ts: Date.now() }, ...Object.fromEntries(kept) }))
  } catch {
    /* private mode / quota — the seat just isn't reclaimable from this browser */
  }
}
