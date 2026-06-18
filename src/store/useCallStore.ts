import { create } from 'zustand'
import type { RoomSecrets } from '@/lib/roomLink'

export interface IncomingCall extends RoomSecrets {
  room: string
  fromName: string
}

/**
 * Incoming-call state, shared by the app-level banner (shown when idle) and the
 * in-call banner (shown inside a room, where merge becomes available). A single
 * Realtime subscription (useIncomingCalls) writes here so both surfaces read one
 * source without subscribing twice.
 */
interface CallState {
  incoming: IncomingCall | null
  setIncoming: (incoming: IncomingCall | null) => void
  dismiss: () => void
}

export const useCallStore = create<CallState>((set) => ({
  incoming: null,
  setIncoming: (incoming) => set({ incoming }),
  dismiss: () => set({ incoming: null }),
}))
