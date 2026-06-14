import { create } from 'zustand'

/**
 * Locally blocked participants (by identity). Blocking is client-side and
 * personal — it hides a participant's tile and silences their audio for *you*
 * only, no host privileges required. Session-scoped (not persisted).
 */
interface BlockState {
  blocked: string[]
  isBlocked: (identity: string) => boolean
  toggle: (identity: string) => void
}

export const useBlockStore = create<BlockState>((set, get) => ({
  blocked: [],
  isBlocked: (identity) => get().blocked.includes(identity),
  toggle: (identity) =>
    set((s) => ({
      blocked: s.blocked.includes(identity)
        ? s.blocked.filter((id) => id !== identity)
        : [...s.blocked, identity],
    })),
}))
