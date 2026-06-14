import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  baseDark,
  baseLight,
  defaultAccentId,
  getAccentPreset,
  type TokenMap,
} from '@/styles/themes'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  accentId: string
  /** Power-user overrides from the custom-theme tab (token -> value). */
  custom: TokenMap
  setMode: (mode: ThemeMode) => void
  setAccent: (id: string) => void
  setCustomToken: (token: string, value: string) => void
  clearCustom: () => void
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark())
}

/** Apply the full token set to <html>. The single point where themes hit the DOM. */
export function applyTheme(state: Pick<ThemeState, 'mode' | 'accentId' | 'custom'>): void {
  const root = document.documentElement
  const dark = resolveDark(state.mode)

  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.style.colorScheme = dark ? 'dark' : 'light'

  const tokens: TokenMap = {
    ...(dark ? baseDark : baseLight),
    ...getAccentPreset(state.accentId).tokens,
    ...state.custom,
  }
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      accentId: defaultAccentId,
      custom: {},
      setMode: (mode) => {
        set({ mode })
        applyTheme(get())
      },
      setAccent: (accentId) => {
        set({ accentId })
        applyTheme(get())
      },
      setCustomToken: (token, value) => {
        set({ custom: { ...get().custom, [token]: value } })
        applyTheme(get())
      },
      clearCustom: () => {
        set({ custom: {} })
        applyTheme(get())
      },
    }),
    {
      name: 'manim-theme',
      // Re-apply once persisted state has rehydrated, so a stored mode/accent
      // wins over the pre-hydration defaults applied by initTheme().
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state)
      },
    },
  ),
)

/** Call once at startup: apply persisted theme + react to system changes. */
export function initTheme(): void {
  applyTheme(useThemeStore.getState())
  if (typeof window !== 'undefined') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (useThemeStore.getState().mode === 'system') {
          applyTheme(useThemeStore.getState())
        }
      })
  }
}
