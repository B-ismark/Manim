import { create } from 'zustand'
import type { PendingKnocker } from '@/lib/orchestrator'

/**
 * Who is knocking at the waiting room, as one shared list.
 *
 * Two surfaces show it — the host's `WaitingRoomBanner` and the Waiting section
 * of People — and they must agree, and must not each ask the server (every ask
 * unseals the queue server-side). So exactly one place fetches it
 * (`useWaitingQueue`, mounted by the banner, which is up for the whole call while
 * the waiting room is on) and both read it from here.
 */
interface WaitingState {
  pending: PendingKnocker[]
  /** Admit (true) or deny (false). Set by the fetcher; a no-op until it is. */
  decide: (p: PendingKnocker, approve: boolean) => void
  set: (pending: PendingKnocker[] | ((prev: PendingKnocker[]) => PendingKnocker[])) => void
  setDecide: (decide: WaitingState['decide']) => void
}

export const useWaitingStore = create<WaitingState>((set) => ({
  pending: [],
  decide: () => {},
  set: (next) => set((s) => ({ pending: typeof next === 'function' ? next(s.pending) : next })),
  setDecide: (decide) => set({ decide }),
}))
