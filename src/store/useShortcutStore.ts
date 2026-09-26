import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ShortcutState {
  /** Single-key call shortcuts (M, V, C, P, F, ?). On by default; switchable off
   *  because a stray key — or speech-input software typing a word — would mute
   *  you or drop your camera (WCAG 2.1.4, character key shortcuts). */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: 'manim-shortcuts' },
  ),
)
