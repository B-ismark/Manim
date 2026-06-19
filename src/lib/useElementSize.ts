import { useLayoutEffect, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/**
 * Observe an element's content-box size via ResizeObserver. Drives the
 * fit-to-viewport tile grid: page capacity is recomputed whenever the stage
 * resizes (window resize, side-panel dock/undock, orientation change) so the
 * layout adapts gracefully instead of clipping or shrinking tiles to dots.
 *
 * The initial measure is taken SYNCHRONOUSLY in a layout effect (before the
 * browser paints), not left at 0×0 for the ResizeObserver's first post-paint
 * callback. Otherwise the tile grid paints its 0×0 fallback first — full-width
 * stacked tiles + a guessed page size — then visibly snaps to the fitted layout
 * a frame later. On join that reads as a flash/reflow as the call appears.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Measure now, before the first paint, so consumers never render against 0×0.
    const rect = el.getBoundingClientRect()
    setSize((s) => (s.width === rect.width && s.height === rect.height ? s : { width: rect.width, height: rect.height }))

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: box.width, height: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}
