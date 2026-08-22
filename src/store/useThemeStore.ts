import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  baseDark,
  baseLight,
  defaultAccentId,
  getAccentPreset,
  highContrastDark,
  highContrastLight,
  type TokenMap,
} from '@/styles/themes'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  accentId: string
  /** Maximum-contrast surfaces/ink for low vision (mode-aware). */
  highContrast: boolean
  /** Power-user overrides from the custom-theme tab (token -> value). */
  custom: TokenMap
  setMode: (mode: ThemeMode) => void
  setAccent: (id: string) => void
  setHighContrast: (on: boolean) => void
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
export function applyTheme(
  state: Pick<ThemeState, 'mode' | 'accentId' | 'highContrast' | 'custom'>,
): void {
  const root = document.documentElement
  const dark = resolveDark(state.mode)
  const base = dark ? baseDark : baseLight
  const preset = getAccentPreset(state.accentId)

  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.style.colorScheme = dark ? 'dark' : 'light'

  const tokens: TokenMap = { ...base, ...preset.tokens }

  // Accent as TEXT/ICON on an accent-soft background, derived per-mode from the
  // chosen preset (same pattern as --color-danger-text). Light keeps the fill
  // accent — it reads on the near-white soft mix. Dark lightens toward white:
  // the raw accent (L≈0.55) against the dark soft mix (L≈0.28) is only ~2:1,
  // which fails even the 3:1 UI-component bar.
  const accentForText = preset.tokens['--color-accent']
  if (accentForText) {
    tokens['--color-accent-text'] = dark
      ? `color-mix(in oklch, ${accentForText} 55%, white)`
      : accentForText
  }

  // Tint the neutral surfaces toward the accent so picking a theme visibly
  // recolours the WHOLE app (Slack model), not just buttons. Skipped for
  // vision-assistive presets and high contrast, which must stay neutral.
  const accent = preset.tokens['--color-accent']
  if (accent && !preset.visionAssistive && !state.highContrast) {
    const tint = (neutral: string, pct: number) =>
      `color-mix(in oklch, ${accent} ${pct}%, ${neutral})`
    tokens['--color-stage'] = tint(base['--color-stage'], 6)
    tokens['--color-surface'] = tint(base['--color-surface'], 3)
    tokens['--color-raised'] = tint(base['--color-raised'], 4)
    tokens['--color-sunken'] = tint(base['--color-sunken'], 6)
    tokens['--color-line'] = tint(base['--color-line'], 8)
  }

  if (state.highContrast) {
    Object.assign(tokens, dark ? highContrastDark : highContrastLight)
  }

  Object.assign(tokens, state.custom)
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      accentId: defaultAccentId,
      highContrast: false,
      custom: {},
      setMode: (mode) => {
        set({ mode })
        applyTheme(get())
      },
      setAccent: (accentId) => {
        set({ accentId })
        applyTheme(get())
      },
      setHighContrast: (highContrast) => {
        set({ highContrast })
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
