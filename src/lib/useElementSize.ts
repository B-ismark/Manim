import { useEffect, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/**
 * Observe an element's content-box size via ResizeObserver. Drives the
 * fit-to-viewport tile grid: page capacity is recomputed whenever the stage
 * resizes (window resize, side-panel dock/undock, orientation change) so the
 * layout adapts gracefully instead of clipping or shrinking tiles to dots.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: box.width, height: box.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, size }
}
