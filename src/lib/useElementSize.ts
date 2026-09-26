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
/**
 * Elements whose padding is animating right now (the call region when the side
 * panel docks, `transition-[padding]`). The 2px threshold below can't collapse
 * that: the stage narrows ~20px a frame for ~300ms, and every frame re-ran the
 * tile packer. While an ancestor's padding is moving, sizes are held and the last
 * one applied when it stops — one relayout instead of eighteen. The panel slides
 * over the stage's edge in the meantime, so the held layout isn't seen clipped.
 */
const moving = new Set<Element>()
const flushers = new Set<() => void>()
let listening = false
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  const start = (e: TransitionEvent) => {
    if (!e.propertyName.startsWith('padding') || !(e.target instanceof Element)) return
    const el = e.target
    moving.add(el)
    // Backstop: a transition that never reports its end must not freeze sizes.
    window.setTimeout(() => stop(el), 1000)
  }
  const stop = (el: EventTarget | null) => {
    if (!(el instanceof Element) || !moving.delete(el)) return
    for (const f of flushers) f()
  }
  const end = (e: TransitionEvent) => {
    if (e.propertyName.startsWith('padding')) stop(e.target)
  }
  document.addEventListener('transitionrun', start, true)
  document.addEventListener('transitionend', end, true)
  document.addEventListener('transitioncancel', end, true)
}
const insideMoving = (el: Element) => {
  for (const m of moving) if (m !== el && m.contains(el)) return true
  return false
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Round to whole pixels and ignore sub-2px deltas. The stage animates its width
    // during the side-panel dock transition (transition-[padding]) — a raw observer
    // fires every frame, re-running the tile packer (gridCapacity/fitMixedRows/
    // presentationLayout) on each, which reads as reflow jank. Snapping + a threshold
    // collapses that continuous stream to at most a couple of relayouts.
    const nearlyEqual = (a: Size, b: Size) => Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2
    // Measure now, before the first paint, so consumers never render against 0×0.
    const rect = el.getBoundingClientRect()
    const initial = { width: Math.round(rect.width), height: Math.round(rect.height) }
    setSize((s) => (nearlyEqual(s, initial) ? s : initial))

    if (typeof ResizeObserver === 'undefined') return
    listen()
    let held: Size | null = null
    const apply = (next: Size) => setSize((s) => (nearlyEqual(s, next) ? s : next))
    const flush = () => {
      // The latest observed size is the settled one: any resize after the
      // transition ends reaches the observer below directly.
      if (held && !insideMoving(el)) {
        const next = held
        held = null
        apply(next)
      }
    }
    flushers.add(flush)
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      const next = { width: Math.round(box.width), height: Math.round(box.height) }
      if (insideMoving(el)) held = next
      else apply(next)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      flushers.delete(flush)
    }
  }, [])

  return { ref, size }
}
