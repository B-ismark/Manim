import type { GridSize } from '@/store/useRoomStore'

/**
 * How many legible tiles fit in the stage without scrolling — drives the paged
 * grid. Columns are bounded by width at a minimum tile width (and √n so a
 * 5-person call doesn't spread to 4 thin columns); rows by height at a minimum
 * tile height. Recomputed on every resize so the layout adapts gracefully
 * (window resize, orientation) instead of clipping or shrinking tiles to dots.
 *
 * `perPage` is what the grid consumes: the packer (fitMixedRows) decides the
 * actual rows and their widths, so `cols` is only the column count this capacity
 * was derived at — useful for reasoning and asserted in tests, not a layout input.
 *
 * `width` is the stage's width WITHOUT the docked side panel's inset — see
 * panelDock's dockedStageInset and the callers in Stage. Feeding it the narrowed
 * width instead is what used to page people out of a call the moment you opened
 * chat: at 1024px the stage lost a column, capacity went 16 → 12, and four
 * people vanished to page 2. Docking the panel should only ever shrink tiles.
 */
export function gridCapacity(
  width: number,
  height: number,
  n: number,
  coarse: boolean,
  sizePref: GridSize,
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
