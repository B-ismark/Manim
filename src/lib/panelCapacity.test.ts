import { describe, it, expect } from 'vitest'
import { gridCapacity, tileColumns } from './tileGrid'
import { dockedStageInset } from './panelDock'

/**
 * Opening the side panel must not page anybody out of the call.
 *
 * Docking the panel narrows the stage. Deciding page CAPACITY from the narrowed
 * width dropped four of sixteen people to page 2 at 1024px — not scaled down,
 * gone. Stage now derives capacity from the width it would have with no panel
 * docked (dockedStageInset), and keeps deriving the COLUMN CAP from the real,
 * narrowed width, because that one is a legibility floor for the space the tiles
 * actually get.
 */

/** GridStage's own `p-2 sm:p-3` — 12px a side at the desktop breakpoint. */
const STAGE_PAD = 24

/**
 * RoomView's reflow, written out from its Tailwind classes rather than from
 * dockedStageInset, so this fails if the two ever drift apart:
 * `panel && 'lg:pr-[22rem] xl:pr-[25rem]'`.
 */
const roomViewReflowPx = (vw: number) => (vw >= 1280 ? 25 * 16 : vw >= 1024 ? 22 * 16 : 0)

/** What the stage's ResizeObserver reports, panel closed vs docked. */
const measured = (vw: number, open: boolean) => vw - (open ? roomViewReflowPx(vw) : 0) - STAGE_PAD
/** ...and the width capacity is decided from, which adds the inset back. */
const capacityWidth = (vw: number) => measured(vw, true) + dockedStageInset(vw)

const WIDTHS = [768, 900, 1024, 1200, 1279, 1280, 1440, 1728]
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

/** The rule Stage applies: the greater of the docked and undocked fits. */
const pageCapacity = (vw: number, open: boolean, coarse = false, pref: 'auto' | number = 'auto') => {
  const real = gridCapacity(measured(vw, open), HEIGHT, coarse, pref).perPage
  const undocked = gridCapacity(open ? capacityWidth(vw) : measured(vw, false), HEIGHT, coarse, pref).perPage
  return Math.max(real, undocked)
}

describe('page capacity across a panel toggle', () => {
  it('never shrinks when the panel docks, at any desktop width', () => {
    for (const vw of WIDTHS) {
      for (const coarse of [false, true]) {
        const closed = pageCapacity(vw, false, coarse)
        const open = pageCapacity(vw, true, coarse)
        expect(open, `${vw}px, coarse=${coarse}: docking the panel paged people out`)
          .toBeGreaterThanOrEqual(closed)
      }
    }
  })

  it('still honours an explicit gallery size, panel or no panel', () => {
    for (const pref of [4, 9, 16] as const) {
      expect(pageCapacity(1024, true, false, pref)).toBe(pageCapacity(1024, false, false, pref))
      expect(pageCapacity(1024, false, false, pref)).toBe(pref)
    }
  })

  it('pins the drops it exists to prevent', () => {
    // Capacity from the NARROWED width alone — what Stage used to do. These are
    // the widths where the lost column is not paid back in extra rows.
    const naive = (vw: number) => gridCapacity(measured(vw, true), HEIGHT, false, 'auto').perPage
    expect(naive(1024)).toBe(18)
    expect(naive(1200)).toBe(12)
    expect(pageCapacity(1024, false)).toBe(20)
    expect(pageCapacity(1200, false)).toBe(16)
    // ...and the fix holds both of them.
    expect(pageCapacity(1024, true)).toBe(20)
    expect(pageCapacity(1200, true)).toBe(16)
  })

  it('keeps the extra capacity a narrower stage affords, rather than capping it', () => {
    // From ~1279px up, narrowing cuts a column but the shorter tiles fit more
    // rows, so the docked stage holds MORE. Substituting the undocked width would
    // have shown twelve people where twenty fit.
    expect(gridCapacity(measured(1440, true), HEIGHT, false, 'auto').perPage).toBe(20)
    expect(pageCapacity(1440, true)).toBe(20)
  })
})

describe('the column cap still follows the real width', () => {
  // The cap is a legibility floor for the space the tiles actually occupy, so it
  // SHOULD tighten when the panel docks. Deriving it from the undocked width
  // would leave rows four wide in three columns' worth of stage.
  it('tightens when the panel takes width away', () => {
    const closed = tileColumns(measured(1024, false), false)
    const open = tileColumns(measured(1024, true), false)
    expect(open).toBeLessThan(closed)
  })

  it('is the cap the packer is handed, not the capacity width', () => {
    expect(tileColumns(measured(1024, true), false)).not.toBe(
      tileColumns(capacityWidth(1024), false),
    )
  })
})
