import { useMemo } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import type { Participant } from 'livekit-client'

/**
 * The signed-in account/guest id stamped into participant metadata at join
 * (see orchestrator). Stable per user across devices — the LiveKit `identity`
 * is per-device (`name#deviceId`), so userId is what ties a person's multiple
 * simultaneous sessions together.
 */
export function userIdOf(p: Participant): string {
  try {
    return JSON.parse(p.metadata || '{}').userId || ''
  } catch {
    return ''
  }
}

/** This client's own userId, read once from the local participant's metadata. */
export function useMyUserId(): string {
  const { localParticipant } = useLocalParticipant()
  return useMemo(() => userIdOf(localParticipant), [localParticipant])
}

/**
 * True when `p` is a *different* live session belonging to the same signed-in
 * user as `myUserId` — i.e. your own other device in this call. Guests are
 * device-bound (no shared userId), so this only matches a real shared account.
 */
export function isMyOtherDevice(p: Participant, myUserId: string): boolean {
  return !p.isLocal && Boolean(myUserId) && userIdOf(p) === myUserId
}
