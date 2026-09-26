import { useRef, type ReactNode } from 'react'
import { useToastClearance } from '@/lib/toastClearance'

/**
 * The one top-centre overlay column.
 *
 * Every top banner and pill used to position itself: its own `fixed`, its own top
 * offset, its own z-index. Several picked the SAME offset (reconnecting, waiting
 * room, handoff and the incoming-call banner all sat at 1rem), so the moment two
 * were on screen together they printed straight over each other — and the ordering
 * between them was decided by whichever z-index its author happened to choose.
 *
 * They are now children of one flex column: they queue downward in priority order
 * instead of colliding, and adding a banner means adding a row, not picking a
 * number. Children render their own pill only — no positioning, no z-index — and
 * mark the interactive part `pointer-events-auto`, since the column lets taps
 * through to the stage gesture layer by default.
 *
 * LAYER SCALE (the whole app, so a new overlay has somewhere to go):
 *   10  stage scrim / in-tile chrome
 *   20  stage-level floats — self-view card, tile controls, corner chips
 *   30  control bar, reactions, and THIS stack
 *   40  modal scrim (Dialog / Sheet overlay)
 *   50  modal surface, and the full-screen incoming-call takeover
 *   60  toasts — always the last word
 *
 * Toasts can't join this column (z-60 has to clear modal scrims; this is z-30),
 * so they queue beneath it instead: the column reports its bottom edge through
 * lib/toastClearance and the toast stack starts there. A child of this column
 * covering a tile's 44px corner control on touch is a separate rule, handled in
 * PinCoachmark, which explains the width cap.
 */
export function TopStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useToastClearance(ref)
  return (
    <div
      ref={ref}
      data-testid="top-stack"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-30 flex flex-col items-center gap-2 px-4"
    >
      {children}
    </div>
  )
}
