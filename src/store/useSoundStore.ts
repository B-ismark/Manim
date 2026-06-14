import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SoundState {
  /** Master toggle for UI sound cues (join/leave/hand/reaction/end). */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

/** Persisted so a user's sound preference survives reloads. Read non-reactively
 *  in lib/sounds.ts via getState(); toggled from the controls. */
export const useSoundStore = create<SoundState>()(
  persist(
    (set, get) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set({ enabled: !get().enabled }),
    }),
    { name: 'manim-sound' },
  ),
)
