import { describe, it, expect } from 'vitest'
import { barDockShift, collidingPanelWidth } from './panelDock'

/**
 * The control bar's width on desktop as host — the widest it gets, with the split
 * Leave / End-for-everyone pill. MEASURED in the running app (tests/zz-probe
 * during development), not estimated: the prototype's mock came out at 560px
 * because it was missing the Audio output button, and the 54px difference was
 * enough to turn a safe offset at 1024px into one that landed on Leave.
 */
const BAR = 614
/**
 * How far right of the Chat button the Leave control starts, and where it ends
 * (the 100px Leave pill plus its End-for-everyone caret). A shift landing inside
 * this band parks a Leave control under a pointer resting where Chat was — the
 * bug this all exists for.
 */
const LEAVE_FROM = 151
const LEAVE_TO = 284

describe('collidingPanelWidth', () => {
  it('sees nothing to collide with below xl — the panel stops above the bar', () => {
    expect(collidingPanelWidth(767)).toBe(0)
    expect(collidingPanelWidth(768)).toBe(0)
    expect(collidingPanelWidth(1024)).toBe(0)
    expect(collidingPanelWidth(1279)).toBe(0)
  })

  it('matches the width Sheet renders beside the bar at xl', () => {
    expect(collidingPanelWidth(1280)).toBe(384) // xl:w-[24rem]
    expect(collidingPanelWidth(1920)).toBe(384)
  })
})

describe('barDockShift', () => {
  it('never moves the bar where the panel stops above it', () => {
    expect(barDockShift(768, BAR)).toBe(0)
    expect(barDockShift(1023, BAR)).toBe(0)
    expect(barDockShift(1024, BAR)).toBe(0)
    expect(barDockShift(1279, BAR)).toBe(0)
  })

  it('never moves the bar once it already clears the panel', () => {
    expect(barDockShift(1440, BAR)).toBe(0)
    expect(barDockShift(1728, BAR)).toBe(0)
  })

  it('moves it by the real overlap where there is one', () => {
    expect(barDockShift(1280, BAR)).toBe(75)
    expect(barDockShift(1320, BAR)).toBe(55)
  })

  it('never parks a Leave control under a pointer resting on Chat', () => {
    for (const vw of [768, 1024, 1280, 1360, 1440, 1728]) {
      const shift = barDockShift(vw, BAR)
      const landsOnLeave = shift >= LEAVE_FROM && shift <= LEAVE_TO
      expect(landsOnLeave, `viewport ${vw}px shifted ${shift}px`).toBe(false)
    }
  })

  it('grows with the bar, so adding a control cannot leave it under the panel', () => {
    // The old static padding was blind to this: a wider bar overlapped further
    // but still moved by exactly half the panel's width.
    expect(barDockShift(1280, BAR + 80)).toBe(barDockShift(1280, BAR) + 40)
  })

  it('has real headroom before a wider bar could reach Leave again', () => {
    // useSettleGuard is the backstop, but the geometry should not be one control
    // away from failing. At xl the bar would have to gain ~150px — three or four
    // more controls — before the offset reached the Leave band at all.
    expect(barDockShift(1280, BAR + 100)).toBeLessThan(LEAVE_FROM)
  })

  it('is a no-op before the bar has been measured', () => {
    expect(barDockShift(1440, 0)).toBe(0)
  })
})
