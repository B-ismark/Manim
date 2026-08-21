import { useCallback, useEffect, useRef } from 'react'

/** The reflow the guard waits out — matches `--dur-base`. */
const REFLOW_MS = 220
/** How long a destructive control stays guarded after the reflow settles. */
const SETTLE_MS = 350
/** Pointer travel that counts as "the user aimed this", and disarms the guard. */
const MOVE_PX = 8

/**
 * Refuse a destructive click the pointer never aimed.
 *
 * When a layout change moves a control under a pointer that has not moved, the
 * next click on it was aimed at whatever used to be there. Opening the side panel
 * does exactly that to the control bar (see lib/panelDock), and the control it
 * can park under the cursor is Leave.
 *
 * Geometry alone can't rule that out for good. The offset is only ever as safe as
 * the bar is narrow: at `xl` it comes to 75px against a Leave band starting at
 * 151px, which is about 150px of bar — three or four controls — of headroom, and
 * nothing about the geometry announces when that headroom has been spent. The
 * first pass at this fix was sized against a bar measured at 560px when the real
 * one is 614px, and the 54px difference was the entire margin. So the invariant
 * lives here instead — arm whenever a reflow moves the bar, and for a short
 * window afterwards a destructive control ignores a pointer click unless the
 * pointer has since travelled `MOVE_PX`.
 *
 * Two things are deliberately never guarded. Keyboard and assistive-tech
 * activation carry no pointer position, so a reflow cannot mis-aim them. And
 * blocking is one-shot: the guard disarms as it rejects, so the user who did mean
 * it presses again and it goes straight through.
 *
 * @param shift the bar's current offset; a change to it means the bar moved.
 * @returns a predicate: true when this click should be rejected.
 */
export function useSettleGuard(shift: number) {
  const last = useRef<{ x: number; y: number } | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const until = useRef(0)

  // One passive listener doing both jobs: remember where the pointer is, so
  // arming has a baseline to compare against, and disarm the moment it travels.
  // `pointerdown` is in here too so the very click that opens the panel leaves a
  // fresh baseline — without it the first arm of a session has nothing to use.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      last.current = { x: e.clientX, y: e.clientY }
      const o = origin.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) >= MOVE_PX) {
        origin.current = null
        until.current = 0
      }
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  // Arm on every change to the offset. A shift that stays 0 — 1440px and up, or
  // the overlay panel below `lg` — moves nothing, so it arms nothing.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    // No pointer has ever been seen here (the panel was opened by keyboard on a
    // machine whose mouse hasn't moved): there is no resting cursor to mis-aim,
    // and no baseline to measure travel from. Leave it disarmed.
    if (!last.current) return
    origin.current = last.current
    until.current = Date.now() + REFLOW_MS + SETTLE_MS
  }, [shift])

  return useCallback((e: { detail: number }) => {
    if (!origin.current || Date.now() >= until.current) return false
    if (e.detail === 0) return false // keyboard / AT activation — never mis-aimed
    origin.current = null
    until.current = 0
    return true
  }, [])
}
