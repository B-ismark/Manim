import { create } from 'zustand'

/** Stable per-browser device id, used for multi-device identity (userId#deviceId). */
function loadDeviceId(): string {
  const KEY = 'manim-device-id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID().slice(0, 8)
    localStorage.setItem(KEY, id)
  }
  return id
}

interface AppState {
  displayName: string
  deviceId: string
  /** Current room's signed LiveKit join token. Sent as Bearer to host endpoints
   *  (admit / moderate / roomflags) so the server can verify host authority. */
  roomToken: string | null
  /** Pre-join device + quality intent, read when connecting to a room. */
  prejoin: {
    micEnabled: boolean
    cameraEnabled: boolean
    lowBandwidth: boolean // audio-only / reduced quality
    /** Optional end-to-end encryption passphrase; all participants must match. */
    e2ee?: string
    audioInputId?: string
    videoInputId?: string
    audioOutputId?: string
  }
  setDisplayName: (name: string) => void
  setPrejoin: (patch: Partial<AppState['prejoin']>) => void
  setRoomToken: (token: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  displayName: '',
  deviceId: loadDeviceId(),
  roomToken: null,
  prejoin: {
    micEnabled: true,
    cameraEnabled: true,
    lowBandwidth: false,
  },
  setDisplayName: (displayName) => set({ displayName }),
  setPrejoin: (patch) => set((s) => ({ prejoin: { ...s.prejoin, ...patch } })),
  setRoomToken: (roomToken) => set({ roomToken }),
}))
