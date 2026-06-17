import { create } from 'zustand'
import { persistNameToAccount } from '@/store/useAuthStore'

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

/** Remembered display name so returning users (and signed-in ones, see useAuthStore)
 *  skip retyping it at every prejoin. */
const NAME_KEY = 'manim-display-name'
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
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
  /** `persist` (default true) also pushes to the signed-in account; pass false to
   *  set the name locally only (used when seeding FROM the account on sign-in, so
   *  it doesn't echo straight back as a write). */
  setDisplayName: (name: string, persist?: boolean) => void
  setPrejoin: (patch: Partial<AppState['prejoin']>) => void
  setRoomToken: (token: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  displayName: loadName(),
  deviceId: loadDeviceId(),
  roomToken: null,
  prejoin: {
    micEnabled: true,
    cameraEnabled: true,
    lowBandwidth: false,
  },
  setDisplayName: (displayName, persist = true) => {
    try {
      // Device fallback: keeps the name for guests + offline, and seeds the
      // account on first sign-in. Signed-in users sync it to their profile too.
      localStorage.setItem(NAME_KEY, displayName)
    } catch {
      /* private mode / storage full — keep the in-memory value */
    }
    set({ displayName })
    if (persist) persistNameToAccount(displayName)
  },
  setPrejoin: (patch) => set((s) => ({ prejoin: { ...s.prejoin, ...patch } })),
  setRoomToken: (roomToken) => set({ roomToken }),
}))
