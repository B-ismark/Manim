import { memo, useEffect, useRef } from 'react'
import { useAnnotate } from '@/features/annotate/useAnnotate'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useElementSize } from '@/lib/useElementSize'
import { useIsTouch } from '@/lib/useIsTouch'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useThemeStore } from '@/store/useThemeStore'

/**
 * Drawing surface over the shared screen.
 *
 * Mounts as a sibling INSIDE the presentation big region (not a portal): the
 * share can go fullscreen on that same element, and a portal to document.body
 * would leave the ink behind when it did.
 *
 * Everything hot lives in AnnotationEngine. This component renders one canvas
 * and never re-renders while drawing — pointer handlers are bound imperatively
 * (React's synthetic events allocate per event, and there are 100+ per second)
 * and the engine paints straight to the canvas.
 *
 * Touch devices are view-only in v1: drawing would have to capture touch, which
 * collides with the control bar's tap-to-reveal, and a share occupying part of a
 * phone screen is too cramped to draw on usefully. Remote strokes still render.
 */
export const AnnotationOverlay = memo(function AnnotationOverlay({ aspect }: { aspect: number }) {
  const { engine, beginLocal } = useAnnotate()
  const active = useAnnotateStore((s) => s.active)
  const allowed = useAnnotateStore((s) => s.allowed)
  const touch = useIsTouch()
  const announce = useAnnounce()
  const { ref: boxRef, size } = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const canDraw = active && allowed && !touch

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    engine.attach(canvas)
    return () => engine.detach()
  }, [engine])

  useEffect(() => {
    engine.setGeometry(size.width, size.height, aspect)
  }, [engine, size.width, size.height, aspect])

  // The engine caches resolved palette tokens (getComputedStyle per stroke per
  // frame would be a style recalc in the render loop). Switching theme or accent
  // rewrites those tokens, so the cache has to be dropped — including the
  // vision-assistive presets, where the whole palette changes at once.
  const themeMode = useThemeStore((s) => s.mode)
  const accentId = useThemeStore((s) => s.accentId)
  const highContrast = useThemeStore((s) => s.highContrast)
  useEffect(() => {
    engine.invalidateColors()
  }, [engine, themeMode, accentId, highContrast])

  // Redraw at the new backing-store scale when the window moves between displays.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onChange = () => engine.setGeometry(size.width, size.height, aspect)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [engine, size.width, size.height, aspect])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !canDraw) return

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!beginLocal(local(e))) return // outside the painted video (letterbox bars)
      canvas.setPointerCapture(e.pointerId)
      // Stop Tile's double-tap/long-press gesture from firing under the pen —
      // the same stopPropagation escape hatch the tile's own controls use.
      e.stopPropagation()
      e.preventDefault()
    }

    const onMove = (e: PointerEvent) => {
      if (!canvas.hasPointerCapture(e.pointerId)) return
      const r = canvas.getBoundingClientRect()
      // Every sample the device produced since the last frame, not just the one
      // event React would have surfaced — this is what makes the curve smooth.
      const raw = e.getCoalescedEvents?.() ?? [e]
      const events = raw.length > 0 ? raw : [e]
      engine.extendLocal(events.map((c) => ({ x: c.clientX - r.left, y: c.clientY - r.top })))
    }

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      engine.endLocal()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove, { passive: true })
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [engine, beginLocal, canDraw])

  // Announce the MODE, not each stroke — a message per pointerdown would be
  // screen-reader spam. Remote authors are announced separately (useAnnotate),
  // which is the signal that actually carries information you can't see.
  const armed = useRef(false)
  useEffect(() => {
    if (armed.current === canDraw) return
    armed.current = canDraw
    announce(canDraw ? 'Annotation on. Draw on the shared screen.' : 'Annotation off.')
  }, [canDraw, announce])

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        data-testid="annotation-canvas"
        // Only the armed pen takes pointer events; otherwise taps fall through to
        // the tile's own spotlight/demote gestures.
        className={canDraw ? 'pointer-events-auto size-full cursor-crosshair' : 'size-full'}
        style={canDraw ? { touchAction: 'none' } : undefined}
        aria-hidden
      />
    </div>
  )
})
