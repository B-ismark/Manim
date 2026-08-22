import type { ReactNode } from 'react'

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
 * KNOWN, and deliberately not fixed here: toasts anchor at `top-4` too, so a toast
 * and a banner in this column DO print over each other (a "Guest joined" toast lands
 * squarely on PinCoachmark, which is why that hint is often half-unreadable). Toasts
 * cannot simply join this column — they sit at z-60 because they must clear modal
 * scrims, and this column is z-30, under them. Fixing it properly means the column
 * yielding to whatever toasts are live, which is a measurement, not an offset. Both
 * are transient and neither steals a tap, so it is cosmetic; the collision that was
 * NOT cosmetic — a child of this column covering a tile's 44px corner control on
 * touch — is handled in PinCoachmark, which explains the width cap.
 */
export function TopStack({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="top-stack"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-30 flex flex-col items-center gap-2 px-4"
    >
      {children}
    </div>
  )
}
