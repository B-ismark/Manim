/*
  Theme presets — the Slack model.
  - `mode` (light | dark | system) controls SURFACE tokens.
  - `accent` preset controls the ACCENT family (and, for vision-assistive
    presets, the status colors too).
  Every preset is just a token map. Applying one = swapping CSS custom
  properties on <html>. No component ever changes. See STYLE.md.
*/

export type TokenMap = Record<string, string>

/* ── Base surface sets (selected by mode) ──────────────────────────────── */

// Light base mirrors the @theme defaults in app.css.
export const baseLight: TokenMap = {
  '--color-stage': 'oklch(0.97 0.005 270)',
  '--color-surface': 'oklch(1 0 0)',
  '--color-raised': 'oklch(0.99 0.004 270)',
  '--color-sunken': 'oklch(0.95 0.006 270)',
  '--color-line': 'oklch(0.91 0.006 270)',
  '--color-line-strong': 'oklch(0.83 0.01 270)',
  '--color-ink': 'oklch(0.22 0.01 270)',
  '--color-ink-muted': 'oklch(0.5 0.012 270)',
  // L=0.52 so subtle text clears AA (4.5:1) on light surfaces — 0.65 was 3.2:1.
  '--color-ink-subtle': 'oklch(0.52 0.012 270)',
  '--color-scrim': 'oklch(0.2 0.02 270 / 0.45)',
  // Danger as TEXT (menu items / error lines): a dark red that clears AA on the
  // light raised/surface (~5.5:1). The fill --color-danger is separate.
  '--color-danger-text': 'oklch(0.5 0.21 25)',
}

export const baseDark: TokenMap = {
  '--color-stage': 'oklch(0.17 0.012 270)',
  '--color-surface': 'oklch(0.23 0.014 270)',
  '--color-raised': 'oklch(0.27 0.016 270)',
  '--color-sunken': 'oklch(0.2 0.012 270)',
  '--color-line': 'oklch(0.32 0.014 270)',
  '--color-line-strong': 'oklch(0.43 0.016 270)',
  '--color-ink': 'oklch(0.96 0.005 270)',
  '--color-ink-muted': 'oklch(0.72 0.01 270)',
  // L=0.65 so subtle text clears AA (4.5:1) on dark surfaces — 0.56 was 3.5:1.
  '--color-ink-subtle': 'oklch(0.65 0.012 270)',
  '--color-scrim': 'oklch(0.08 0.02 270 / 0.6)',
  // danger (the FILL) stays the single @theme value (L=0.55) in both modes — it
  // must be dark enough for white danger-ink on danger fills (Leave / mute-off).
  // Danger as TEXT needs the opposite in dark mode: a LIGHT red that reads on a
  // dark surface. L=0.72 clears AA (~4.7:1) on --color-raised (0.27) and more on
  // the darker --color-sunken; this is what the red menu items / error lines use.
  '--color-danger-text': 'oklch(0.72 0.16 25)',
}

/* ── High-contrast overrides (mode-aware) ──────────────────────────────────
   Applied on top of the base set when the user turns High contrast on. Pure
   neutral surfaces + maximum ink/line separation for low-vision users. */
export const highContrastLight: TokenMap = {
  '--color-stage': 'oklch(1 0 0)',
  '--color-surface': 'oklch(1 0 0)',
  '--color-raised': 'oklch(1 0 0)',
  '--color-sunken': 'oklch(0.94 0 0)',
  '--color-line': 'oklch(0.45 0 0)',
  '--color-line-strong': 'oklch(0.2 0 0)',
  '--color-ink': 'oklch(0.1 0 0)',
  '--color-ink-muted': 'oklch(0.24 0 0)',
  '--color-ink-subtle': 'oklch(0.32 0 0)',
  '--color-scrim': 'oklch(0 0 0 / 0.6)',
}

export const highContrastDark: TokenMap = {
  '--color-stage': 'oklch(0.06 0 0)',
  '--color-surface': 'oklch(0.12 0 0)',
  '--color-raised': 'oklch(0.17 0 0)',
  '--color-sunken': 'oklch(0.03 0 0)',
  '--color-line': 'oklch(0.62 0 0)',
  '--color-line-strong': 'oklch(0.82 0 0)',
  '--color-ink': 'oklch(1 0 0)',
  '--color-ink-muted': 'oklch(0.86 0 0)',
  '--color-ink-subtle': 'oklch(0.72 0 0)',
  '--color-scrim': 'oklch(0 0 0 / 0.75)',
}

/* ── Accent presets (named tiles in the theme picker) ──────────────────── */

export interface AccentPreset {
  id: string
  name: string
  tokens: TokenMap
  /** Representative color for the picker swatch. */
  swatch: string
  /** Vision-assistive presets are grouped separately + always accessible. */
  visionAssistive?: boolean
}

function accent(a: string, hover: string): TokenMap {
  return { '--color-accent': a, '--color-accent-hover': hover }
}

// Near-black ink for LIGHT accent fills. The default --color-accent-ink is near-white
// (good on dark accents like Aurora/Graphite at L≈0.55), but on lighter accents white
// text fails WCAG AA (computed: Lagoon 3.68, Jade 3.31, Clementine 2.75, Rose 3.44).
// Dark ink clears AA on all of them (4.97–6.65). Set per-preset so button/chip/pill
// text on the accent fill stays legible whatever theme is chosen.
const DARK_INK = 'oklch(0.18 0 0)'
function accentDark(a: string, hover: string): TokenMap {
  return { '--color-accent': a, '--color-accent-hover': hover, '--color-accent-ink': DARK_INK }
}

export const accentPresets: AccentPreset[] = [
  { id: 'aurora', name: 'Aurora', swatch: 'oklch(0.55 0.18 275)', tokens: accent('oklch(0.55 0.18 275)', 'oklch(0.49 0.19 275)') },
  { id: 'lagoon', name: 'Lagoon', swatch: 'oklch(0.6 0.13 230)', tokens: accentDark('oklch(0.6 0.13 230)', 'oklch(0.54 0.14 230)') },
  { id: 'jade', name: 'Jade', swatch: 'oklch(0.62 0.14 160)', tokens: accentDark('oklch(0.62 0.14 160)', 'oklch(0.56 0.15 160)') },
  { id: 'clementine', name: 'Clementine', swatch: 'oklch(0.7 0.17 50)', tokens: accentDark('oklch(0.7 0.17 50)', 'oklch(0.64 0.18 50)') },
  { id: 'rose', name: 'Rose', swatch: 'oklch(0.65 0.18 5)', tokens: accentDark('oklch(0.65 0.18 5)', 'oklch(0.59 0.19 5)') },
  { id: 'graphite', name: 'Graphite', swatch: 'oklch(0.55 0.02 270)', tokens: accent('oklch(0.55 0.02 270)', 'oklch(0.48 0.02 270)') },

  // Vision-assistive: high-distinction palettes that don't rely on red/green
  // discrimination. Status colors overridden too.
  {
    id: 'deuteranopia',
    name: 'Deuteranopia',
    swatch: 'oklch(0.6 0.15 250)',
    visionAssistive: true,
    tokens: {
      ...accent('oklch(0.6 0.15 250)', 'oklch(0.54 0.16 250)'),
      // Dark ink on the lighter accent + orange danger — white failed AA (accent
      // 3.83, danger 2.72); dark clears both (4.77 / 6.73). A vision-assistive preset
      // especially must not ship sub-AA text.
      '--color-accent-ink': DARK_INK,
      '--color-danger-ink': DARK_INK,
      '--color-success': 'oklch(0.68 0.13 250)', // blue stands in for green
      '--color-danger': 'oklch(0.7 0.17 60)', // orange stands in for red
      '--color-danger-hover': 'oklch(0.64 0.18 60)',
      '--color-speaking': 'oklch(0.7 0.14 250)',
    },
  },
  {
    id: 'tritanopia',
    name: 'Tritanopia',
    swatch: 'oklch(0.62 0.19 20)',
    visionAssistive: true,
    tokens: {
      // Dark ink on the lighter red accent (white was 3.89, dark is 4.70).
      ...accent('oklch(0.62 0.19 20)', 'oklch(0.56 0.2 20)'),
      '--color-accent-ink': DARK_INK,
      '--color-success': 'oklch(0.72 0.14 195)', // cyan
      // Darkened from L=0.6 so the danger fill keeps white danger-ink yet clears AA
      // (white on 0.6 was 4.25; on 0.55 it's ~5.1, matching the default red).
      '--color-danger': 'oklch(0.55 0.21 20)',
      '--color-danger-hover': 'oklch(0.49 0.22 20)',
      '--color-speaking': 'oklch(0.72 0.14 195)',
    },
  },
]

export const defaultAccentId = 'aurora'

export function getAccentPreset(id: string): AccentPreset {
  return accentPresets.find((p) => p.id === id) ?? accentPresets[0]
}
