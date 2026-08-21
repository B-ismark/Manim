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
 * Layout constants, by pointer type. `coarse` is touch (useIsTouch / pointer:
 * coarse), which covers phones AND tablets — not a width breakpoint.
 */
const GAP = { coarse: 8, fine: 12 }
/**
 * Smallest width we will render a face in. This is the legibility floor, and it
 * is what decides the column count — see `tileColumns`.
 */
const MIN_TILE_W = { coarse: 132, fine: 200 }
/**
 * Hard ceiling on columns. Touch caps at 3 (the "2x2 up to 3x3" decision); a
 * mouse pointer caps at 4.
 */
const MAX_COLS = { coarse: 3, fine: 4 }
/**
 * Nominal tile shape, used only to decide how many ROWS fit once the column
 * width is known. Touch senders are overwhelmingly portrait phones (3:4 after
 * bucketing), desktop senders landscape. The real per-tile aspects still drive
 * the packer — this only sizes the PAGE.
 */
const NOMINAL_ASPECT = { coarse: 3 / 4, fine: 16 / 9 }

/**
 * How many columns fit at the legibility floor.
 *
 * This is the whole density decision, and it is keyed off WIDTH, not headcount.
 * Three columns needs `3 * 132 + 2 * 8 = 412px` of stage, which a 430px viewport
 * has (414px) and a 412px Pixel 7 does not (396px). So every phone shipping today
 * renders 2 columns and 3 unlocks on the largest phones and on tablets — where it
 * matters most, because a coarse pointer used to mean a flat 2 columns and an iPad
 * in portrait was paging through 368px-wide tiles four at a time.
 *
 * Pushing to 3 columns below that threshold would mean 96-127px faces, i.e.
 * lowering the floor this function is built around. The floor stays.
 */
export function tileColumns(stageWidth: number, coarse: boolean): number {
  const key = coarse ? 'coarse' : 'fine'
  const gap = GAP[key]
  const min = MIN_TILE_W[key]
  if (stageWidth < 2) return 1
  const byWidth = Math.floor((stageWidth + gap) / (min + gap))
  return Math.max(1, Math.min(MAX_COLS[key], byWidth))
}

/**
 * How many legible tiles fit on one page, and in how many columns.
 *
 * Columns come from `tileColumns` (width at the legibility floor). Rows come from
 * how many tiles of THAT column width actually stack in the available height at
 * the nominal aspect — which is the correction over the previous version. That one
 * derived rows from an independent `minH: 116`, a landscape-ish box, while the
 * packer laid out 3:4 portrait video: it claimed 5 rows would fit on a 375x667
 * phone, so a page was 9 tiles of 114x152 rendered 3 across, in defiance of both
 * the 2-column cap and the 132px floor. Deriving rows from the column width keeps
 * the two consistent by construction.
 *
 * The page is then capped: `cols * cols` on touch, which is exactly "2x2 up to
 * 3x3", and 20 on desktop. The cap also guarantees pagination engages for big
 * rooms independently of the measured height (a flex chain can briefly report an
 * unbounded height) and bounds mounted <video> elements per page, which is the
 * point of paging.
 */
export function gridCapacity(
  width: number,
  height: number,
  coarse: boolean,
  sizePref: GridSizePref,
): { cols: number; perPage: number } {
  const key = coarse ? 'coarse' : 'fine'
  const gap = GAP[key]
  const cols = tileColumns(width, coarse)
  const maxPerPage = coarse ? cols * cols : 20
  // User-chosen density (Teams "gallery size"): the page is exactly the picked
  // count — tiles shrink to fit, pager engages — clamped to what the device can
  // legibly hold. This overrides the fit-to-viewport below.
  if (sizePref !== 'auto') {
    return { cols, perPage: Math.max(1, Math.min(sizePref, maxPerPage)) }
  }
  // Before the first measure, fall back to a sane page so we don't flash a huge
  // mount of every tile.
  if (width < 2 || height < 2) {
    return { cols, perPage: coarse ? 4 : 9 }
  }
  const tileW = (width - gap * (cols - 1)) / cols
  const tileH = tileW / NOMINAL_ASPECT[key]
  const rows = Math.max(1, Math.floor((height + gap) / (tileH + gap)))
  return { cols, perPage: Math.max(1, Math.min(cols * rows, maxPerPage)) }
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
  maxCols?: number,
): { w: number; h: number }[][] {
  const n = aspects.length
  if (n === 0 || width <= 0 || height <= 0) return []
  // Two passes when a column cap is given: honour it if any candidate split can,
  // otherwise fall back to unconstrained. The fallback matters — a user who picks
  // "9" from the gallery-size control on a 2-column phone is explicitly asking for
  // tiles that shrink to fit, and returning nothing would render an empty stage.
  const constrained = maxCols !== undefined ? pack(width, height, aspects, gap, maxCols) : null
  return constrained?.length ? constrained : pack(width, height, aspects, gap)
}

function pack(
  width: number,
  height: number,
  aspects: number[],
  gap: number,
  maxCols?: number,
): { w: number; h: number }[][] {
  const n = aspects.length
  let best: { score: number; rows: { w: number; h: number }[][] } = { score: -1, rows: [] }
  for (let R = 1; R <= n; R++) {
    const groups = balancedRows(aspects, R)
    const rr = groups.length
    // The column cap is a legibility floor expressed as a count — a row wider than
    // it would render faces below MIN_TILE_W. Skip the candidate rather than clamp
    // it, so the scorer picks the best layout that actually respects the cap.
    if (maxCols !== undefined && groups.some((g) => g.length > maxCols)) continue
    // Row height that fills the width at this row's combined aspect.
    let rowH = groups.map((g) => {
      const sum = g.reduce((s, a) => s + a, 0)
      return (width - gap * (g.length - 1)) / sum
    })
    if (rowH.some((h) => h <= 0)) continue
    // Under a column cap, every row takes the SAME height — the tightest row's —
    // and a short row simply doesn't span the full width.
    //
    // Without this, a row holding fewer tiles stretches them to fill the width, so
    // it comes out much taller than its neighbours and drags the whole stack's
    // scale down with it. On a paged gallery that is very visible: at 375px a full
    // page of four rendered 176px tiles while the three-person remainder page
    // rendered 140px ones, so tiles changed size as you swiped. Uniform rows with
    // a short last row is also what every phone gallery does — gaps at the end,
    // not a giant final tile.
    if (maxCols !== undefined) {
      const uniform = Math.min(...rowH)
      rowH = rowH.map(() => uniform)
    }
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
