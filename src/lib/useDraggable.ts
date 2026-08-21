import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

interface DragState {
  startX: number
  startY: number
  originX: number
  originY: number
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

/**
 * How far a pointer must travel before the gesture counts as a DRAG.
 *
 * It used to be one pixel — `moved` was set by the first pointermove, whatever its
 * distance — which is fine while dragging is the only thing the element does. It
 * stops being fine the moment the same element also responds to a tap (the
 * self-view's expand): a finger never lands and lifts on exactly the same pixel, so
 * every tap registered as a drag, snapped the card to a corner, and swallowed the
 * tap. Exported so the tap side and the drag side test the same number.
 */
export const DRAG_SLOP = 6

/**
 * Which corner is a box's centre nearest? Pure so the snap is testable.
 *
 * `bounds` is the area the box may occupy — the viewport inset by `margin`, and on
 * a phone also inset at the bottom by the control island, so a card can never come
 * to rest underneath it.
 */
export function nearestCorner(
  box: { x: number; y: number; w: number; h: number },
  bounds: { left: number; top: number; right: number; bottom: number },
): Corner {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const midX = (bounds.left + bounds.right) / 2
  const midY = (bounds.top + bounds.bottom) / 2
  return `${cy < midY ? 't' : 'b'}${cx < midX ? 'l' : 'r'}` as Corner
}

/** Top-left position of a box parked in `corner` of `bounds`. */
export function cornerPosition(
  corner: Corner,
  box: { w: number; h: number },
  bounds: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number } {
  return {
    x: corner[1] === 'l' ? bounds.left : Math.max(bounds.left, bounds.right - box.w),
    y: corner[0] === 't' ? bounds.top : Math.max(bounds.top, bounds.bottom - box.h),
  }
}

/**
 * Pointer-drag positioning for a floating element (the self-view card), snapping
 * to the nearest corner on release.
 *
 * The snap is the point. Every reference app's self-view is a *corner* card you can
 * move — Meet, Teams, Discord — and the corner part was missing: a free drag left
 * the card wherever your thumb stopped, so it could sit halfway down an edge, or
 * (before `reserveBottom`) come to rest under the control island where you could
 * neither see it nor drag it back out. Position also reset on every remount, so a
 * card moved out of the way of a shared spreadsheet was back over it after the next
 * layout change.
 *
 * Remembering the CORNER rather than the pixels is what makes it survive a rotation:
 * "bottom right" still means something at a different viewport size, where a stored
 * x/y means nothing at all.
 */
export function useDraggable(
  margin = 8,
  opts: { initial?: Corner; reserveBottom?: number } = {},
) {
  const { initial = 'br', reserveBottom = 0 } = opts
  const [corner, setCorner] = useState<Corner>(initial)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<DragState | null>(null)
  /** Set once the user actually drags, so an un-dragged card keeps its CSS anchor. */
  const moved = useRef(false)

  const boundsFor = useCallback(
    (el: HTMLElement) => ({
      left: margin,
      top: margin,
      right: window.innerWidth - margin,
      bottom: window.innerHeight - margin - reserveBottom,
      w: el.offsetWidth,
      h: el.offsetHeight,
    }),
    [margin, reserveBottom],
  )

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return
      const el = e.currentTarget
      const b = boundsFor(el)
      const nx = drag.current.originX + (e.clientX - drag.current.startX)
      const ny = drag.current.originY + (e.clientY - drag.current.startY)
      // Follow the finger 1:1 while dragging — clamped, but not snapped. Snapping
      // mid-drag makes the card fight the thumb.
      setPos({
        x: Math.min(Math.max(b.left, nx), b.right - b.w),
        y: Math.min(Math.max(b.top, ny), b.bottom - b.h),
      })
      if (Math.hypot(e.clientX - drag.current.startX, e.clientY - drag.current.startY) > DRAG_SLOP) {
        moved.current = true
      }
    },
    [boundsFor],
  )

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const el = e.currentTarget
      drag.current = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
      if (!moved.current) return
      moved.current = false
      const b = boundsFor(el)
      const rect = el.getBoundingClientRect()
      const next = nearestCorner({ x: rect.left, y: rect.top, w: b.w, h: b.h }, b)
      setCorner(next)
      setPos(cornerPosition(next, b, b))
    },
    [boundsFor],
  )

  const style: CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined

  return { style, corner, handlers: { onPointerDown, onPointerMove, onPointerUp } }
}
