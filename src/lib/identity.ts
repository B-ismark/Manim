import type { Participant } from 'livekit-client'

/**
 * The account this seat belongs to, as this call knows it: a per-room
 * pseudonym the server stamps into metadata (server/account.mjs), the same for
 * all of one person's devices here and different in every other call. Never the
 * account id itself, and self-asserted (metadata is rewritable): fine for
 * grouping a roster, never for trust. Trust goes through lib/sameAccount.
 * '' for a guest.
 */
export function accountOf(p: Participant): string {
  try {
    return JSON.parse(p.metadata || '{}').acct || ''
  } catch {
    return ''
  }
}
