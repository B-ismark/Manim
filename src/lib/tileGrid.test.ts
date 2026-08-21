import { describe, it, expect } from 'vitest'
import { balancedRows, bucketAspect, fitMixedRows, gridCapacity, tileColumns } from './tileGrid'

/** Row shape as tile counts — the thing that's easy to read and easy to get wrong. */
const shape = (rows: number[][]) => rows.map((r) => r.length)
const same = (n: number, aspect: number) => Array<number>(n).fill(aspect)

const PORTRAIT = 3 / 4
const LANDSCAPE = 16 / 9
/** src/islands/Stage.tsx at the mobile-sm viewport (375×667, stage p-2). */
const PHONE = { w: 359, h: 651, gap: 8 }
/** The desktop Playwright project (1280×800). */
const DESK = { w: 1256, h: 776, gap: 12 }

describe('bucketAspect', () => {
  it('clamps a portrait phone to 3:4 rather than its raw 9:16', () => {
    expect(bucketAspect(9 / 16)).toBe(PORTRAIT)
  })
  it('keeps a wide camera at 16:9', () => {
    expect(bucketAspect(16 / 9)).toBe(LANDSCAPE)
    expect(bucketAspect(4 / 3)).toBe(LANDSCAPE)
  })
  it('snaps near-square to 1:1', () => {
    expect(bucketAspect(1)).toBe(1)
    expect(bucketAspect(1.1)).toBe(1)
  })
})

describe('balancedRows', () => {
  it('returns the number of rows it was asked for', () => {
    // The regression this module exists for: the accumulator reset per row while
    // the threshold kept climbing, so only the first row could ever close. Nine
    // equal tiles asked for 3 rows used to come back as 2 ([3, 6]); asked for 9,
    // as 2 ([1, 8]).
    for (const r of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(balancedRows(same(9, PORTRAIT), r), `asked for ${r} rows`).toHaveLength(r)
    }
  })

  it('splits equal tiles evenly', () => {
    expect(shape(balancedRows(same(9, PORTRAIT), 3))).toEqual([3, 3, 3])
    expect(shape(balancedRows(same(16, LANDSCAPE), 4))).toEqual([4, 4, 4, 4])
    expect(shape(balancedRows(same(20, LANDSCAPE), 5))).toEqual([4, 4, 4, 4, 4])
    expect(shape(balancedRows(same(6, PORTRAIT), 2))).toEqual([3, 3])
  })

  it('gives every row at least one tile, even when asked for more rows than tiles', () => {
    const rows = balancedRows(same(3, LANDSCAPE), 9)
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.length).toBeGreaterThan(0))
  })

  it('never reorders — the concatenation is the input', () => {
    const input = [PORTRAIT, LANDSCAPE, 1, PORTRAIT, LANDSCAPE, 1, PORTRAIT]
    for (const r of [2, 3, 4]) {
      expect(balancedRows(input, r).flat()).toEqual(input)
    }
  })

  it('balances by summed ASPECT, not by count, when aspects differ', () => {
    // Four tiles, one very wide: it should not sit alone with three narrow ones
    // beside it — each row's summed aspect should land near total/2.
    const rows = balancedRows([PORTRAIT, PORTRAIT, PORTRAIT, LANDSCAPE], 2)
    const sums = rows.map((r) => r.reduce((s, a) => s + a, 0))
    expect(rows).toHaveLength(2)
    expect(Math.abs(sums[0] - sums[1])).toBeLessThan(LANDSCAPE)
  })

  it('handles the degenerate inputs', () => {
    expect(balancedRows([], 3)).toEqual([[]])
    expect(shape(balancedRows([LANDSCAPE], 4))).toEqual([1])
    expect(shape(balancedRows(same(5, LANDSCAPE), 1))).toEqual([5])
    expect(shape(balancedRows(same(5, LANDSCAPE), 0))).toEqual([5])
  })
})

describe('fitMixedRows', () => {
  const flat = (rows: { w: number; h: number }[][]) => rows.flat()

  it('never overflows the box it was given', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const box of [PHONE, DESK]) {
        const rows = fitMixedRows(box.w, box.h, same(n, PORTRAIT), box.gap)
        const stack = rows.reduce((s, r) => s + r[0].h, 0) + box.gap * (rows.length - 1)
        expect(stack, `${n} tiles in ${box.w}×${box.h}`).toBeLessThanOrEqual(box.h + 0.5)
        rows.forEach((r) => {
          const width = r.reduce((s, t) => s + t.w, 0) + box.gap * (r.length - 1)
          expect(width).toBeLessThanOrEqual(box.w + 0.5)
        })
      }
    }
  })

  it('gives every tile in a row the same height', () => {
    const rows = fitMixedRows(DESK.w, DESK.h, [PORTRAIT, LANDSCAPE, PORTRAIT, LANDSCAPE], DESK.gap)
    rows.forEach((r) => r.forEach((t) => expect(t.h).toBeCloseTo(r[0].h, 5)))
  })

  it('keeps a portrait tile portrait beside a landscape one', () => {
    const rows = fitMixedRows(DESK.w, DESK.h, [PORTRAIT, LANDSCAPE], DESK.gap)
    const tiles = flat(rows)
    expect(tiles).toHaveLength(2)
    // Same row, same height, and each keeps its own aspect — no shared cell.
    expect(tiles[0].w / tiles[0].h).toBeCloseTo(PORTRAIT, 3)
    expect(tiles[1].w / tiles[1].h).toBeCloseTo(LANDSCAPE, 3)
  })

  it('puts a 1-on-1 side by side rather than stacked', () => {
    const rows = fitMixedRows(DESK.w, DESK.h, same(2, LANDSCAPE), DESK.gap)
    expect(shape(rows.map((r) => r.map(() => 0)))).toEqual([1, 1])
  })

  it('packs nine phone senders as a uniform 3×3, not a ragged 2/4/3', () => {
    // The user-visible payoff of the balancedRows fix: this used to render a
    // 176×234 top row next to an 84×112 middle row.
    const rows = fitMixedRows(PHONE.w, PHONE.h, same(9, PORTRAIT), PHONE.gap)
    expect(rows.map((r) => r.length)).toEqual([3, 3, 3])
    const heights = rows.map((r) => r[0].h)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  })

  it('is empty for no tiles or a collapsed box', () => {
    expect(fitMixedRows(DESK.w, DESK.h, [], DESK.gap)).toEqual([])
    expect(fitMixedRows(0, DESK.h, same(4, LANDSCAPE), DESK.gap)).toEqual([])
    expect(fitMixedRows(DESK.w, 0, same(4, LANDSCAPE), DESK.gap)).toEqual([])
  })
})

/** Stage width for a viewport, given the stage's `p-2` (8px a side). */
const stageW = (viewportW: number) => viewportW - 16

describe('tileColumns', () => {
  // The floor is 132px on touch. 3 columns needs 3*132 + 2*8 = 412px of stage.
  it('gives every phone shipping today 2 columns', () => {
    for (const vw of [320, 360, 375, 390, 412]) {
      expect(tileColumns(stageW(vw), true), `${vw}px viewport`).toBe(2)
    }
  })

  it('unlocks the third column at 430px, where it clears the floor', () => {
    expect(tileColumns(stageW(430), true)).toBe(3)
  })

  it('gives a tablet 3 columns, not the flat 2 a coarse pointer used to get', () => {
    expect(tileColumns(stageW(744), true)).toBe(3)
    expect(tileColumns(stageW(768), true)).toBe(3)
    expect(tileColumns(stageW(1024), true)).toBe(3)
  })

  it('never renders a tile below the 132px floor on touch', () => {
    for (const vw of [320, 360, 375, 390, 412, 430, 540, 744, 768, 1024]) {
      const w = stageW(vw)
      const cols = tileColumns(w, true)
      const tile = (w - 8 * (cols - 1)) / cols
      expect(tile, `${vw}px viewport at ${cols} cols`).toBeGreaterThanOrEqual(132)
    }
  })

  it('caps at 3 on touch and 4 with a mouse', () => {
    expect(tileColumns(4000, true)).toBe(3)
    expect(tileColumns(4000, false)).toBe(4)
  })

  it('always gives at least one column, even unmeasured', () => {
    expect(tileColumns(0, true)).toBe(1)
    expect(tileColumns(40, true)).toBe(1)
  })
})

describe('gridCapacity', () => {
  it('is 2x2 on a phone and 3x3 on a large phone — the density decision', () => {
    expect(gridCapacity(stageW(375), 667 - 16, true, 'auto')).toEqual({ cols: 2, perPage: 4 })
    expect(gridCapacity(stageW(412), 915 - 16, true, 'auto')).toEqual({ cols: 2, perPage: 4 })
    expect(gridCapacity(stageW(430), 932 - 16, true, 'auto')).toEqual({ cols: 3, perPage: 9 })
  })

  it('never exceeds cols x cols on touch', () => {
    for (const [vw, vh] of [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024]] as const) {
      const { cols, perPage } = gridCapacity(stageW(vw), vh - 16, true, 'auto')
      expect(perPage, `${vw}x${vh}`).toBeLessThanOrEqual(cols * cols)
    }
  })

  it('caps a desktop page at 20', () => {
    expect(gridCapacity(DESK.w, DESK.h, false, 'auto').perPage).toBeLessThanOrEqual(20)
  })

  it('honours an explicit gallery size, clamped to what the device can hold', () => {
    expect(gridCapacity(PHONE.w, PHONE.h, true, 4).perPage).toBe(4)
    expect(gridCapacity(PHONE.w, PHONE.h, true, 16).perPage).toBe(4) // 2 cols -> 2x2
    expect(gridCapacity(stageW(430), 932 - 16, true, 9).perPage).toBe(9)
    expect(gridCapacity(DESK.w, DESK.h, false, 16).perPage).toBe(16)
  })

  it('falls back to a small page before the first measure', () => {
    expect(gridCapacity(0, 0, true, 'auto').perPage).toBe(4)
    expect(gridCapacity(0, 0, false, 'auto').perPage).toBe(9)
  })

  it('always allows at least one tile', () => {
    expect(gridCapacity(10, 10, true, 'auto').perPage).toBeGreaterThanOrEqual(1)
    expect(gridCapacity(PHONE.w, PHONE.h, true, 0).perPage).toBeGreaterThanOrEqual(1)
  })
})

describe('fitMixedRows column cap', () => {
  it('respects the cap', () => {
    const rows = fitMixedRows(PHONE.w, PHONE.h, same(4, PORTRAIT), PHONE.gap, 2)
    expect(rows.map((r) => r.length)).toEqual([2, 2])
    rows.forEach((r) => expect(r.length).toBeLessThanOrEqual(2))
  })

  it('falls back rather than rendering nothing when the cap is unsatisfiable', () => {
    // 9 tiles at 2 columns needs 5 rows, which balancedRows can produce — but if it
    // could not, an empty stage would be far worse than an over-wide row.
    const rows = fitMixedRows(PHONE.w, PHONE.h, same(9, PORTRAIT), PHONE.gap, 2)
    expect(rows.flat()).toHaveLength(9)
  })

  it('keeps tile size identical across a full page and a remainder page', () => {
    // The paging consequence of uniform rows. At 375px a page holds 4; an 11-person
    // gallery pages as 4 / 4 / 3, and the 3-tile page must not render smaller tiles
    // than the 4-tile pages just because its last row is short.
    const full = fitMixedRows(PHONE.w, 575, same(4, PORTRAIT), PHONE.gap, 2)
    const remainder = fitMixedRows(PHONE.w, 575, same(3, PORTRAIT), PHONE.gap, 2)
    expect(Math.round(remainder[0][0].w)).toBe(Math.round(full[0][0].w))
    expect(Math.round(remainder[0][0].h)).toBe(Math.round(full[0][0].h))
  })

  it('gives every capped row the same height, short last row included', () => {
    const rows = fitMixedRows(PHONE.w, 575, same(3, PORTRAIT), PHONE.gap, 2)
    expect(rows.map((r) => r.length)).toEqual([2, 1])
    const heights = rows.map((r) => r[0].h)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5)
  })

  it('a short capped row does not span the full width', () => {
    const rows = fitMixedRows(PHONE.w, 575, same(3, PORTRAIT), PHONE.gap, 2)
    const lastRowWidth = rows[1].reduce((s, t) => s + t.w, 0)
    expect(lastRowWidth).toBeLessThan(PHONE.w * 0.75)
  })

  it('is unchanged when no cap is given', () => {
    const capped = fitMixedRows(PHONE.w, PHONE.h, same(9, PORTRAIT), PHONE.gap, 3)
    const free = fitMixedRows(PHONE.w, PHONE.h, same(9, PORTRAIT), PHONE.gap)
    expect(capped.map((r) => r.length)).toEqual(free.map((r) => r.length))
  })
})
