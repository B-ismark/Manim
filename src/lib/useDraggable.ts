import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

interface DragState {
  startX: number
  startY: number
  originX: number
  originY: number
}

/**
 * Pointer-drag positioning for a floating element (e.g. the self-view card).
 * Returns inline `style` (null until first drag — element keeps its CSS anchor)
 * and pointer handlers. Position is clamped to the viewport.
 */
export function useDraggable(margin = 8) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<DragState | null>(null)

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return
      const el = e.currentTarget
      const nx = drag.current.originX + (e.clientX - drag.current.startX)
      const ny = drag.current.originY + (e.clientY - drag.current.startY)
      const x = Math.min(Math.max(margin, nx), window.innerWidth - el.offsetWidth - margin)
      const y = Math.min(Math.max(margin, ny), window.innerHeight - el.offsetHeight - margin)
      setPos({ x, y })
    },
    [margin],
  )

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }, [])

  const style: CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : undefined

  return { style, handlers: { onPointerDown, onPointerMove, onPointerUp } }
}
