/**
 * Why a call ended, for the end-of-call screen.
 *
 * Most endings look the same to LiveKit: the app itself disconnected. So the
 * code path that ends a call says why, just before it disconnects (`markEnd`),
 * and RoomRoute takes that reason when the disconnect arrives. Anything unmarked
 * falls back to what LiveKit reports (removed, room deleted, or a drop).
 */
export type EndReason = 'left' | 'ended' | 'endedByYou' | 'removed' | 'alone' | 'dropped'

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
