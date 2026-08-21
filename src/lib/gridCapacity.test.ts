import { describe, it, expect } from 'vitest'
import { gridCapacity } from './gridCapacity'
import { dockedStageInset } from './panelDock'
import { presentationLayout, userRegionCapacity } from './shareLayout'

/**
 * Opening the side panel must not page anybody out of the call.
 *
 * Docking the panel narrows the stage. Deciding tile capacity from the narrowed
 * width took the grid from 4 columns to 3 at 1024px, capacity from 16 to 12, and
 * four people to page 2 — not scaled down, gone. Capacity is now decided from the
 * width the stage would have with no panel docked, so docking can only shrink
 * tiles (which fitMixedRows already does well).
 */

/** GridStage's own `p-2 sm:p-3` — 12px a side at the desktop breakpoint. */
const STAGE_PAD = 24

/**
 * RoomView's reflow, written out from the Tailwind classes rather than from
 * dockedStageInset, so this test fails if the two ever drift apart:
 * `panel && 'lg:pr-[22rem] xl:pr-[25rem]'`.
 */
const roomViewReflowPx = (vw: number) => (vw >= 1280 ? 25 * 16 : vw >= 1024 ? 22 * 16 : 0)

/** What GridStage's ResizeObserver actually reports, panel closed vs docked. */
const measured = (vw: number, open: boolean) => vw - (open ? roomViewReflowPx(vw) : 0) - STAGE_PAD

const WIDTHS = [768, 1024, 1200, 1280, 1440, 1728]
const CROWDS = [2, 4, 8, 12, 16, 20, 30]
const HEIGHT = 800 - STAGE_PAD

describe('dockedStageInset', () => {
  it('takes nothing below lg, where the panel floats over the stage', () => {
    expect(dockedStageInset(767)).toBe(0)
    expect(dockedStageInset(768)).toBe(0)
    expect(dockedStageInset(1023)).toBe(0)
  })

  it("matches RoomView's reflow padding at every width", () => {
    for (const vw of [768, 1023, 1024, 1279, 1280, 1440, 1728]) {
      expect(dockedStageInset(vw), `${vw}px`).toBe(roomViewReflowPx(vw))
    }
  })
})

describe('grid capacity across a panel toggle', () => {
  it('is unchanged by docking the panel, at every desktop width and crowd size', () => {
    for (const vw of WIDTHS) {
      for (const n of CROWDS) {
        const closed = gridCapacity(measured(vw, false), HEIGHT, n, false, 'auto')
        const open = gridCapacity(measured(vw, true) + dockedStageInset(vw), HEIGHT, n, false, 'auto')
        expect(open, `${vw}px with ${n} in the call`).toEqual(closed)
      }
    }
  })

  it('is unchanged on touch too, where the panel is a sheet and takes no width', () => {
    for (const n of CROWDS) {
      const closed = gridCapacity(390 - STAGE_PAD, HEIGHT, n, true, 'auto')
      const open = gridCapacity(390 - STAGE_PAD + dockedStageInset(390), HEIGHT, n, true, 'auto')
      expect(open).toEqual(closed)
    }
  })

  it('still honours an explicit gallery size, panel or no panel', () => {
    const closed = gridCapacity(measured(1024, false), HEIGHT, 30, false, 9)
    const open = gridCapacity(measured(1024, true) + dockedStageInset(1024), HEIGHT, 30, false, 9)
    expect(closed.perPage).toBe(9)
    expect(open).toEqual(closed)
  })

  it('pins the drop it exists to prevent', () => {
    // Deciding capacity from the NARROWED width — what the code used to do.
    const closed = gridCapacity(measured(1024, false), HEIGHT, 16, false, 'auto')
    const naive = gridCapacity(measured(1024, true), HEIGHT, 16, false, 'auto')
    expect(closed).toEqual({ cols: 4, perPage: 16 })
    expect(naive).toEqual({ cols: 3, perPage: 12 }) // four people to page 2
  })
})

describe('presentation filmstrip capacity across a panel toggle', () => {
  // Same rule for the share layout's user region, which pages into a "+N" tile.
  const capacity = (vw: number, open: boolean, n: number) => {
    const w = measured(vw, open) + (open ? dockedStageInset(vw) : 0)
    const L = presentationLayout(w, HEIGHT, n, 16 / 9, 12)
    return userRegionCapacity(L.grid.w, L.grid.h, false)
  }

  it('is unchanged by docking the panel', () => {
    for (const vw of WIDTHS) {
      for (const n of CROWDS) {
        expect(capacity(vw, true, n), `${vw}px with ${n} in the call`).toBe(capacity(vw, false, n))
      }
    }
  })
})
