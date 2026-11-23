/**
 * The look of annotation ink. Pure functions — no canvas, no DOM — so the shape
 * of a stroke is unit-testable while the LiveKit gates are frozen.
 *
 * WHY STROKES ARE OUTLINES, NOT LINES
 * A stroke used to be a `lineTo` polyline with a round cap. Locally that looked
 * fine (coalesced pointer events are dense), but what crosses the wire is the
 * RDP-simplified version (`rdp.ts`) — a handful of corner points — so on every
 * OTHER screen a circle arrived as a polygon. And it had to wear a dark halo to
 * stay legible, which read as a heavy outline.
 *
 * Now every stroke, local or remote, goes through the same two steps:
 *  1. `densify` — a Catmull-Rom spline through the points, resampled at an even
 *     pixel spacing. The simplified wire points become a curve again, so a
 *     viewer's ink is as round as the author's.
 *  2. `outline` — perfect-freehand (MIT; the ink tldraw and Excalidraw use) turns
 *     that centre line into a filled shape that tapers at both ends, like a felt
 *     tip. Because the input is evenly resampled, the simulated pressure is the
 *     same on every screen whatever the sender's pointer rate was.
 */

import { getStroke } from 'perfect-freehand'

/** Ink width as a fraction of the content box's smaller side (resolution-independent). */
export const INK_SIZE_FRACTION = 0.0045
export const MIN_INK_PX = 2.5
export const MAX_INK_PX = 6

export function inkSize(contentW: number, contentH: number): number {
  return Math.max(MIN_INK_PX, Math.min(MAX_INK_PX, Math.min(contentW, contentH) * INK_SIZE_FRACTION))
}

/**
 * Upper bound on resampled points per stroke. A long scribble on a big screen
 * would otherwise resample into thousands of points, and the outline is rebuilt
 * whenever the stroke grows (and every frame while it dissolves). Past this the
 * spacing widens instead — at that length nobody can see the difference.
 */
export const MAX_DENSE_POINTS = 600

/**
 * Catmull-Rom through `n` pixel points (flat [x0,y0,x1,y1,…]), resampled at
 * roughly `spacing` px. Returns flat pixel coords. A single point comes back as
 * itself, so a tap still renders as a dot.
 */
export function densify(pts: ArrayLike<number>, n: number, spacing: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [pts[0], pts[1]]
  let total = 0
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
  const step = Math.max(spacing, total / MAX_DENSE_POINTS, 0.5)
  const out: number[] = [pts[0], pts[1]]
  const at = (i: number, k: 0 | 1) => pts[Math.max(0, Math.min(n - 1, i)) * 2 + k]
  for (let i = 0; i < n - 1; i++) {
    const seg = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 1) - at(i, 1))
    const steps = Math.max(1, Math.round(seg / step))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t
      for (const k of [0, 1] as const) {
        const p0 = at(i - 1, k), p1 = at(i, k), p2 = at(i + 1, k), p3 = at(i + 2, k)
        out.push(
          0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3),
        )
      }
    }
  }
  return out
}

/**
 * Filled outline polygon for a centre line (flat pixel coords, from `from`).
 * `complete` tapers the head too; a stroke still being drawn keeps a round head
 * so it doesn't look like it's shrinking under the pen.
 */
export function outline(dense: readonly number[], from: number, size: number, complete: boolean): number[][] {
  const input: number[][] = []
  for (let i = from * 2; i + 1 < dense.length; i += 2) input.push([dense[i], dense[i + 1]])
  if (input.length === 0) return []
  return getStroke(input, {
    size,
    thinning: 0.5,
    smoothing: 0.6,
    streamline: 0.4,
    simulatePressure: true,
    last: complete,
    start: { taper: size * 2.5, cap: true },
    end: { taper: complete ? size * 3 : 0, cap: true },
  })
}

/**
 * The text colour that reads on a chip filled with `color`. The palette spans
 * L 0.53 (blue) to L 0.95 (near-white); white text only clears WCAG AA (4.5:1 at
 * 12px) on the darkest of them, so everything from vermillion (L 0.6) up gets
 * near-black. Anything that isn't an oklch() we can read gets near-black too —
 * the safer default on a palette that is mostly mid-to-light.
 */
export const CHIP_TEXT_LIGHT = 'oklch(0.99 0 0)'
export const CHIP_TEXT_DARK = 'oklch(0.2 0.01 260)'
export function chipTextColor(color: string): string {
  const m = /oklch\(\s*([\d.]+)(%?)/i.exec(color)
  if (!m) return CHIP_TEXT_DARK
  const l = Number(m[1]) / (m[2] ? 100 : 1)
  return l < 0.58 ? CHIP_TEXT_LIGHT : CHIP_TEXT_DARK
}

export interface ChipBox {
  x: number
  y: number
  w: number
  h: number
}

export const CHIP_H = 22
export const CHIP_PAD_X = 8
const CHIP_GAP_X = 12
const CHIP_GAP_Y = 10

/**
 * Where a name chip sits for a pen head at (hx, hy): below-right of it, flipped
 * left / up when that would leave the content box, and never outside it.
 */
export function chipBox(
  hx: number,
  hy: number,
  textW: number,
  content: { x: number; y: number; w: number; h: number },
): ChipBox {
  const w = textW + CHIP_PAD_X * 2
  const h = CHIP_H
  const right = content.x + content.w
  const bottom = content.y + content.h
  let x = hx + CHIP_GAP_X
  if (x + w > right) x = hx - CHIP_GAP_X - w
  let y = hy + CHIP_GAP_Y
  if (y + h > bottom) y = hy - CHIP_GAP_Y - h
  x = Math.max(content.x, Math.min(right - w, x))
  y = Math.max(content.y, Math.min(bottom - h, y))
  return { x, y, w, h }
}

/**
 * Shift-drawn lines snap to multiples of this many degrees. 15° rather than the
 * 45° of a shape tool: an annotation points at things anywhere on the screen, so
 * it needs plenty of angles, while a nearly-level underline still lands exactly
 * level (anything within 7.5° of it does).
 */
export const SNAP_DEG = 15

/**
 * The end of a line from (ax, ay) towards (x, y), rotated to the nearest
 * `stepDeg` angle and keeping its length projected onto that angle, so the end
 * tracks the pointer along the snapped direction. In PIXELS: a unit-space angle
 * would come out skewed on any non-square share.
 */
export function snapLine(ax: number, ay: number, x: number, y: number, stepDeg: number): { x: number; y: number } {
  const dx = x - ax
  const dy = y - ay
  if (dx === 0 && dy === 0) return { x: ax, y: ay }
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const len = Math.max(0, dx * ux + dy * uy)
  // Exact zeros for the axes, so a level line is level to the last bit.
  const ex = Math.abs(ux) < 1e-9 ? 0 : ux * len
  const ey = Math.abs(uy) < 1e-9 ? 0 : uy * len
  return { x: ax + ex, y: ay + ey }
}
