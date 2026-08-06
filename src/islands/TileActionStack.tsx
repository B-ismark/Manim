import type { ReactNode } from 'react'

/**
 * The one top-right column inside a video tile.
 *
 * Same bug as TopStack's, one level down. Three siblings each picked their own
 * vertical offset in the same corner — the tile's action button at `top-2`, the
 * fullscreen control at `top-14`, the annotate control at `top-[6.5rem]` — and each
 * of those numbers is an assumption about the heights of the other two. Adding a
 * fourth control meant measuring the stack by hand and hoping; changing an
 * IconButton size meant silently breaking a file that never mentioned it.
 *
 * They queue downward from one anchor now, spaced by `gap`. A control renders its
 * own button and nothing else: no `absolute`, no offset, no z-index. Order in the
 * source is order on screen.
 *
 * z-20 on the stack matches the layer scale documented in TopStack ("stage-level
 * floats — self-view card, tile controls, corner chips"). Fullscreen's exit button
 * deliberately stays OUTSIDE this stack at z-30: in fullscreen it is the only
 * control that should exist, which is a different concern from ordering.
 *
 * `pointer-events-none` on the column with `pointer-events-auto` on each child, so
 * the gaps between buttons fall through to the tile's own double-tap/long-press
 * gestures rather than swallowing them.
 */
export function TileActionStack({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="tile-action-stack"
      className="pointer-events-none absolute right-2 top-2 z-20 flex flex-col items-end gap-2"
      // Drawing on the share must not be interrupted by the tile's gestures, and a
      // press that starts on a control is never a tile gesture.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

/** One row in the stack. Wraps a control so it takes pointer events back. */
export function TileAction({ children }: { children: ReactNode }) {
  return <div className="pointer-events-auto">{children}</div>
}
