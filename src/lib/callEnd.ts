/**
 * Why a call ended, for the end-of-call screen.
 *
 * Most endings look the same to LiveKit: the app itself disconnected. So the
 * code path that ends a call says why, just before it disconnects (`markEnd`),
 * and RoomRoute takes that reason when the disconnect arrives. Anything unmarked
 * falls back to what LiveKit reports (removed, room deleted, or a drop).
 */
export type EndReason = 'left' | 'ended' | 'endedByYou' | 'removed' | 'moved' | 'alone' | 'dropped'

let pending: EndReason | null = null

export function markEnd(reason: EndReason): void {
  pending = reason
}

/** The marked reason, once; `fallback` when nothing was marked. */
export function takeEnd(fallback: EndReason): EndReason {
  const r = pending ?? fallback
  pending = null
  return r
}

/**
 * Who was in the call, for the end-of-call summary. Noted while the call runs
 * (RoomView), because by the time the screen shows the room is gone and so is its
 * participant list. Keyed by the person, not the device: two tabs of the same
 * account are one face in "who was there". Names only, in memory, for one screen.
 */
const people = new Map<string, string>()

export function resetPeople(): void {
  people.clear()
}

/** `who` is the account id where there is one, else the LiveKit identity. */
export function notePerson(who: string, name: string): void {
  if (!people.has(who) || name) people.set(who, name || people.get(who) || '')
}

/** Everyone noted since the last reset, you included; clears. */
export function takePeople(): string[] {
  const names = [...people.values()]
  people.clear()
  return names
}
