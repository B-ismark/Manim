import { describe, it, expect } from 'vitest'
import {
  accentPresets,
  accentTextFor,
  baseDark,
  baseLight,
  highContrastDark,
  highContrastLight,
} from './themes'

/**
 * Real WCAG ratios for `--color-accent-text` on `--color-accent-soft`.
 *
 * This is a gate, not a mirror of the implementation: it re-implements the
 * *browser's* `color-mix(in oklch, …)` and the sRGB relative-luminance formula,
 * then measures what the production token strings actually resolve to. The
 * project's axe pass is the only other thing that would catch a regression here
 * and it needs a browser + a live LiveKit room, so this is the cheap gate.
 *
 * The pairing under test: `bg-accent-soft text-accent-text` — Badge's accent
 * tone, the chat mention picker's selected row, and the reaction chip's count.
 */

type Oklch = [L: number, C: number, H: number]

/** `oklch(L C H)` → components. */
function parseOklch(css: string): Oklch {
  const m = css.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/)
  if (!m) throw new Error(`not an oklch() colour: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const WHITE: Oklch = [1, 0, 0]
const BLACK: Oklch = [0, 0, 0]

/**
 * CSS Color 4 `color-mix(in oklch, c1 p%, c2)`. A component whose chroma is 0
 * has a POWERLESS hue and adopts the other colour's — which is why mixing with
 * `white` keeps the accent's hue rather than dragging it toward 0.
 */
function mix(c1: Oklch, c2: Oklch, p: number): Oklch {
  const L = c1[0] * p + c2[0] * (1 - p)
  const C = c1[1] * p + c2[1] * (1 - p)
  const h1 = c1[1] === 0 ? c2[2] : c1[2]
  const h2 = c2[1] === 0 ? c1[2] : c2[2]
  const delta = (((h2 - h1 + 540) % 360) - 180) * (1 - p) // shorter arc
  return [L, C, (h1 + delta + 360) % 360]
}

/** Resolve the CSS a production helper emits, including one nested color-mix. */
function resolve(css: string): Oklch {
  const cm = css.match(/^color-mix\(in oklch,\s*(.+?)\s+([\d.]+)%,\s*(white|black)\s*\)$/)
  if (!cm) return parseOklch(css)
  return mix(parseOklch(cm[1]), cm[3] === 'white' ? WHITE : BLACK, Number(cm[2]) / 100)
}

function toSrgb([L, C, H]: Oklch): [number, number, number] {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const enc = (x: number) => {
    const v = Math.max(0, Math.min(1, x))
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  }
  return [
    enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrast(fg: Oklch, bg: Oklch): number {
  const lum = (c: Oklch) => {
    const [r, g, b] = toSrgb(c)
    const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const a = lum(fg)
  const b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Reproduce applyTheme's surface for one (preset, mode, high-contrast) combo. */
function surfaceFor(preset: (typeof accentPresets)[number], dark: boolean, hc: boolean): Oklch {
  if (hc) return parseOklch((dark ? highContrastDark : highContrastLight)['--color-surface'])
  const base = parseOklch((dark ? baseDark : baseLight)['--color-surface'])
  // applyTheme tints neutrals 3% toward the accent, except for vision-assistive
  // presets (and high contrast, handled above).
  if (preset.visionAssistive) return base
  return mix(parseOklch(preset.tokens['--color-accent']!), base, 0.03)
}

const AA_TEXT = 4.5

describe('--color-accent-text on --color-accent-soft', () => {
  const combos = accentPresets.flatMap((preset) =>
    [true, false].flatMap((dark) =>
      [false, true].map((hc) => ({ preset, dark, hc })),
    ),
  )

  it.each(combos)(
    '$preset.id / $dark dark / $hc high-contrast clears AA 4.5:1',
    ({ preset, dark, hc }) => {
      const accent = preset.tokens['--color-accent']!
      // --color-accent-soft is defined in app.css as color-mix(accent 16%, surface).
      const soft = mix(parseOklch(accent), surfaceFor(preset, dark, hc), 0.16)
      const text = resolve(accentTextFor(accent, dark))
      expect(contrast(text, soft)).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it('is a real improvement on the raw accent, which failed in both modes', () => {
    // Guards the reason the derivation exists: dropping back to the undiluted
    // accent must go red here, not pass quietly.
    const worstRaw = Math.min(
      ...combos.map(({ preset, dark, hc }) => {
        const accent = parseOklch(preset.tokens['--color-accent']!)
        return contrast(accent, mix(accent, surfaceFor(preset, dark, hc), 0.16))
      }),
    )
    expect(worstRaw).toBeLessThan(AA_TEXT)
  })

  it('keeps the accent hue rather than washing to grey', () => {
    // A naive linear hue mix with white/black would drag hue toward 0 and turn
    // every preset's text pinkish.
    const aurora = accentPresets.find((p) => p.id === 'aurora')!
    const accent = parseOklch(aurora.tokens['--color-accent']!)
    for (const dark of [true, false]) {
      expect(resolve(accentTextFor(aurora.tokens['--color-accent']!, dark))[2]).toBeCloseTo(
        accent[2],
        5,
      )
    }
  })
})
