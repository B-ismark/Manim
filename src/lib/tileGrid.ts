/**
 * Tile-grid geometry for the gallery layout — how many tiles fit on a page, and
 * how a page's worth of MIXED-ASPECT tiles packs into justified rows.
 *
 * Pure functions — no React, no LiveKit — so the packing maths is unit-testable,
 * the same split `lib/shareLayout.ts` makes for the presentation layout. It lived
 * inside `islands/Stage.tsx` until a row-balancing bug went unnoticed there for
 * want of any way to assert on it (see `balancedRows`).
 */

/** Gallery-size preference: 'auto' fits the viewport, a number caps the page. */
export type GridSizePref = 'auto' | number

/**
 * Snap a raw frame aspect (w/h) to a tidy bucket so one odd stream can't make a
 * grid row absurdly tall or wide. Portrait phones clamp to 3:4 (NOT raw 9:16 —
 * that blows out row height), wide cams to 16:9, near-square to 1:1. Mirrors the
 * AWS IVS portrait/square/landscape model. Unknown/camera-off tiles default to
 * 16:9 upstream so the grid stays calm until a real frame arrives.
 */
export function bucketAspect(ratio: number): number {
  if (ratio <= 0.85) return 3 / 4
  if (ratio >= 1.2) return 16 / 9
  return 1
}

/**
 * How many legible tiles fit in the stage without scrolling — drives the paged
 * grid. Columns are bounded by width at a minimum tile width (and √n so a
 * 5-person call doesn't spread to 4 thin columns); rows by height at a minimum
 * tile height. Recomputed on every resize so the layout adapts gracefully
 * (window resize, side-panel dock, orientation) instead of clipping or shrinking
 * tiles to dots.
 *
 * `cols` bounds the PAGE SIZE, not the rendered column count — `fitMixedRows`
 * chooses rows from the aspects it's given and doesn't take a column budget. The
 * two used to be the same number, back when the grid was a fixed-column CSS grid.
 */
export function gridCapacity(
  width: number,
  height: number,
  n: number,
  coarse: boolean,
  sizePref: GridSizePref,
): { cols: number; perPage: number } {
  const gap = coarse ? 8 : 12
  const minW = coarse ? 132 : 200
  const minH = coarse ? 116 : 150
  const maxCols = coarse ? 2 : 4
  // Hard cap so pagination ALWAYS engages for big rooms — independent of the
  // measured height (a flex chain can briefly report an unbounded grid height,
  // which would otherwise compute a perPage large enough to mount every tile).
  // Also bounds mounted <video>/DOM per page (perf), the point of paging.
  const MAX_PER_PAGE = coarse ? 9 : 20
  // User-chosen density (Teams "gallery size"): the page is exactly the picked count
  // — tiles shrink to fit, pager engages — clamped to what the device can legibly
  // hold. This overrides the auto fit-to-viewport below.
  if (sizePref !== 'auto') {
    const perPage = Math.max(1, Math.min(sizePref, MAX_PER_PAGE))
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(perPage))))
    return { cols, perPage }
  }
  // Before the first measure, fall back to a sane page so we don't flash a huge
  // mount of every tile.
  if (width < 2 || height < 2) {
    const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(n))))
    return { cols, perPage: coarse ? 4 : 9 }
  }
  const byWidth = Math.floor((width + gap) / (minW + gap))
  const bySqrt = Math.ceil(Math.sqrt(n))
  const cols = Math.max(1, Math.min(maxCols, byWidth, bySqrt))
  const rows = Math.max(1, Math.floor((height + gap) / (minH + gap)))
  return { cols, perPage: Math.max(1, Math.min(cols * rows, MAX_PER_PAGE)) }
}

/**
 * Split an ORDERED aspect list into `rows` contiguous groups, balancing the summed
 * aspect per row so rows come out near-equal width. Contiguous (never reorders) so
 * tile order — and thus paging — stays stable. Each remaining row is guaranteed at
 * least one tile.
 *
 * Two corrections over the original, both visible on a portrait phone:
 *
 * 1. **The accumulator is cumulative, matching the threshold.** It used to reset to
 *    zero after every row while the threshold `total * (rowsDone+1) / r` kept
 *    climbing, so only the FIRST row could ever hit its bar — every later row had
 *    to absorb a growing share of the total on its own, and the split degenerated.
 *    Asking for R rows almost never returned R rows: nine equal tiles asked for 3
 *    rows and got `[3, 6]`, asked for 9 and got `[1, 8]`. Uniform grids were never
 *    even generated, so the scorer in `fitMixedRows` never got to choose one.
 * 2. **A crossing closes on the NEARER side of the target**, not on first crossing.
 *    First-crossing overshoots systematically, which is what left rows ragged even
 *    once (1) generated the right row counts.
 *
 * Together, at 359×651 with nine portrait senders: `2 / 4 / 3` (176×234 tiles
 * beside 84×112 ones — a 2× size difference between people in the same call)
 * becomes a uniform `3 / 3 / 3`. On a 1256-wide desktop, sixteen tiles go from
 * `5 / 4 / 3 / 4` to `4 / 4 / 4 / 4`.
 */
export function balancedRows(aspects: number[], rows: number): number[][] {
  const r = Math.min(rows, aspects.length)
  if (r <= 1) return [aspects.slice()]
  const total = aspects.reduce((s, a) => s + a, 0)
  const out: number[][] = []
  let cur: number[] = []
  // Running total across ALL rows so far — see (1) above.
  let acc = 0
  for (let i = 0; i < aspects.length; i++) {
    cur.push(aspects[i])
    acc += aspects[i]
    const rowsDone = out.length
    const tilesLeft = aspects.length - i - 1
    const rowsLeft = r - rowsDone - 1
    // Close the row once the running total crosses this row's share, but only while
    // there are still enough tiles to give every remaining row at least one.
    if (rowsDone >= r - 1 || tilesLeft < rowsLeft) continue
    const target = (total * (rowsDone + 1)) / r
    if (acc < target) continue
    // Crossed. Land on whichever side of the target is closer — but never empty the
    // row to do it, and never steal a tile a later row is relying on.
    const overshoot = acc - target
    const undershoot = target - (acc - aspects[i])
    if (cur.length > 1 && overshoot > undershoot && tilesLeft + 1 >= rowsLeft) {
      out.push(cur.slice(0, -1))
      cur = [aspects[i]]
    } else {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * Mixed-orientation grid packer (Google Meet "dynamic layouts" model). Lays `n`
 * tiles of VARYING aspect into justified equal-height rows, picking the row count
 * that maximizes the smallest tile (legibility). Each row is scaled to fill the
 * width; if the stack would overflow the height it's scaled down uniformly and
 * centered — so it always fits without scrolling. Returns per-tile {w,h} grouped
 * by row, in the original (contiguous) order. Replaces a single-aspect fit: a
 * portrait phone feed gets a portrait tile beside a laptop's 16:9, instead of
 * being center-cropped into a shared 16:9 cell.
 */
export function fitMixedRows(
  width: number,
  height: number,
  aspects: number[],
  gap: number,
): { w: number; h: number }[][] {
  const n = aspects.length
  if (n === 0 || width <= 0 || height <= 0) return []
  let best: { score: number; rows: { w: number; h: number }[][] } = { score: -1, rows: [] }
  for (let R = 1; R <= n; R++) {
    const groups = balancedRows(aspects, R)
    const rr = groups.length
    // Row height that fills the width at this row's combined aspect.
    const rowH = groups.map((g) => {
      const sum = g.reduce((s, a) => s + a, 0)
      return (width - gap * (g.length - 1)) / sum
    })
    if (rowH.some((h) => h <= 0)) continue
    // Scale rows to the height left AFTER the inter-row gaps — gaps are fixed, so
    // they must come out of the budget first or the stack overflows by a few px.
    const sumH = rowH.reduce((s, h) => s + h, 0)
    const availH = height - gap * (rr - 1)
    if (availH <= 0) continue
    const scale = sumH > availH ? availH / sumH : 1
    const sized = groups.map((g, ri) => {
      const h = rowH[ri] * scale
      return g.map((a) => ({ w: h * a, h }))
    })
    // Score by the smallest tile (legibility). R ascends, so a later (taller) row
    // count must beat the current best by a clear margin to win — otherwise we keep
    // the wider, fewer-row layout, matching the Zoom/Meet desktop norm (a 1-on-1
    // sits side-by-side, not stacked, on a near-tie).
    const minH = Math.min(...rowH) * scale
    if (minH > best.score * 1.05) best = { score: minH, rows: sized }
  }
  return best.rows
}
