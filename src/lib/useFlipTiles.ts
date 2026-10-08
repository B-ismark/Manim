import { useCallback, useLayoutEffect, useRef } from 'react'

export type TileBox = { key: string; x: number; y: number; w: number; h: number }

const DURATION_MS = 360 // --dur-slow
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)' // --ease-island

/**
 * Glide positioned tiles to their new boxes on the compositor (FLIP).
 *
 * The phone gallery used to animate `left, top, width, height` with a CSS
 * transition. Every one of those is a layout property, so each frame of the glide
 * — the bars fading, someone joining, a rotation — re-laid-out every tile and its
 * video, on the device least able to afford it, while it was also decoding video.
 *
 * Now the tile snaps to its final box at once (ONE layout) and a transform plays
 * it from where it was: First, Last, Invert, Play. Transforms run on the
 * compositor, so the glide costs no layout at all. The scale is per-axis and brief;
 * on the small moves a re-pack makes it reads as the tile easing into place.
 *
 * `active` false (desktop: a re-pack there follows a dragged window, where any lag
 * reads as sluggish) or a reduced-motion preference: tiles just snap.
 */
export function useFlipTiles(boxes: TileBox[], active: boolean) {
  const els = useRef(new Map<string, HTMLElement>())
  const last = useRef(new Map<string, TileBox>())

  const ref = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(key, el)
      else els.current.delete(key)
    },
    [],
  )

  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, TileBox>()
    for (const b of boxes) {
      next.set(b.key, b)
      const target = last.current.get(b.key)
      const el = els.current.get(b.key)
      if (!active || reduced || !target || !el || !el.animate || b.w <= 0 || b.h <= 0) continue
      // Same destination: nothing to do, and a glide in flight is left to finish
      // (restarting it on every unrelated render would stretch it out forever).
      if (target.x === b.x && target.y === b.y && target.w === b.w && target.h === b.h) continue
      // Start from where the tile IS, not where it was headed: a second re-pack
      // inside a glide (the bars hide, a tap brings them straight back) would
      // otherwise snap it to the old target first. A running glide's transform is
      // relative to that old target box, origin top-left.
      const prev = { ...target }
      const live = el.getAnimations().length ? getComputedStyle(el).transform : 'none'
      if (live && live !== 'none') {
        const m = new DOMMatrixReadOnly(live)
        prev.x = target.x + m.e
        prev.y = target.y + m.f
        prev.w = target.w * m.a
        prev.h = target.h * m.d
      }
      const dx = prev.x - b.x
      const dy = prev.y - b.y
      const sx = prev.w / b.w
      const sy = prev.h / b.h
      // Cancelled whatever happens next: a glide in flight is relative to the OLD box.
      for (const a of el.getAnimations()) a.cancel()
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue
      el.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: DURATION_MS, easing: EASING },
      )
    }
    last.current = next
  }, [boxes, active])

  return ref
}
