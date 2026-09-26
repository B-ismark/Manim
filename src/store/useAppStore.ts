import { create } from 'zustand'
import { cleanDisplayName } from '@/lib/displayName'
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
    return cleanDisplayName(localStorage.getItem(NAME_KEY) ?? '')
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

const PREJOIN_KEY = 'manim-prejoin'

/** Your last mic/camera choice on the prejoin screen, so a camera-off person
 *  isn't greeted by their camera every time. Only a deliberate toggle is saved
 *  (`rememberPrejoin`); the camera switching off because it failed is not. */
function loadPrejoinChoice(): { micEnabled: boolean; cameraEnabled: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PREJOIN_KEY) || '{}')
    return { micEnabled: v.micEnabled !== false, cameraEnabled: v.cameraEnabled !== false }
  } catch {
    return { micEnabled: true, cameraEnabled: true }
  }
}

export function rememberPrejoin(patch: { micEnabled?: boolean; cameraEnabled?: boolean }): void {
  try {
    const next = { ...loadPrejoinChoice(), ...patch }
    localStorage.setItem(PREJOIN_KEY, JSON.stringify(next))
  } catch {
    /* private mode — the choice just isn't remembered */
  }
}

export const useAppStore = create<AppState>((set) => ({
  displayName: loadName(),
  deviceId: loadDeviceId(),
  roomToken: null,
  prejoin: {
    ...loadPrejoinChoice(),
    lowBandwidth: false,
  },
  setDisplayName: (raw, persist = true) => {
    // Profile names from sign-in go through here too, so this is the one gate.
    const displayName = cleanDisplayName(raw)
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
