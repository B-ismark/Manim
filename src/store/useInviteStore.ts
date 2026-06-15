import { create } from 'zustand'

export interface PendingInvite {
  id: string
  /** Display label — the email or name the invite was sent to. */
  label: string
  /** When it was sent (epoch ms), for the auto-expiry sweep. */
  ts: number
}

/**
 * Outgoing invites that haven't joined yet — rendered as ghost "Invited ·
 * waiting" rows under the roster. Client/device-local only (no server state):
 * a hint for the inviter, not authoritative presence. Entries are dropped when
 * the invitee shows up or after a few minutes (see useInviteStore consumers).
 */
interface InviteState {
  pending: PendingInvite[]
  addInvite: (label: string) => void
  clearInvite: (id: string) => void
}

export const useInviteStore = create<InviteState>((set) => ({
  pending: [],
  addInvite: (label) =>
    set((s) => {
      const key = label.trim().toLowerCase()
      if (!key || s.pending.some((p) => p.label.toLowerCase() === key)) return s
      return {
        pending: [
          ...s.pending,
          { id: `${Date.now()}-${key}`, label: label.trim(), ts: Date.now() },
        ],
      }
    }),
  clearInvite: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),
}))
