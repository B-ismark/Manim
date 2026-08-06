import { memo, useEffect, useRef, useState } from 'react'
import { useAnnotate } from '@/features/annotate/useAnnotate'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useElementSize } from '@/lib/useElementSize'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useThemeStore } from '@/store/useThemeStore'
import { useSharePresence } from '@/lib/useSharePresence'
import { penCursor } from '@/features/annotate/penCursor'
import { colorVar } from '@/lib/annotate/palette'

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
  // One shared answer to "is drawing possible right now" — the same value the two
  // pen buttons render on and the same one that disarms the pen. This used to be
  // re-derived here from `allowed && !touch`, which is most of that condition but
  // not all of it, and the gap is how an armed pen outlived its own canvas.
  const { canAnnotate, featuredShareId } = useSharePresence()
  const { engine, beginLocal, localColorIdx } = useAnnotate(featuredShareId)
  const active = useAnnotateStore((s) => s.active)
  const announce = useAnnounce()
  const { ref: boxRef, size } = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const canDraw = active && canAnnotate

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    engine.attach(canvas)
    // Finish any stroke still in progress before letting go of the canvas.
    // Spotlighting a person unmounts this component from under the pointer, and
    // without the endLocal() the stroke never got its final flush: the tail was
    // never sent, and the engine kept a live stroke that nothing would ever close.
    return () => {
      engine.endLocal()
      engine.detach()
    }
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

  // The armed cursor, in this author's own palette colour.
  //
  // Resolved from the CSS custom property rather than hardcoded (STYLE.md §1), and
  // re-resolved whenever the theme rewrites the palette — the same invalidation the
  // engine's own colour cache needs, for the same reason.
  const [cursor, setCursor] = useState('crosshair')
  useEffect(() => {
    if (!canDraw) return
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(colorVar(localColorIdx))
      .trim()
    setCursor(resolved ? penCursor(resolved) : 'crosshair')
  }, [canDraw, localColorIdx, themeMode, accentId, highContrast])

  // NOTE: there used to be an effect here that called applyConstraints({cursor:'never'})
  // on the live share track to keep the OS pointer out of the outgoing capture while
  // the pen was armed. It is gone, and the reasoning it rested on is worth recording.
  //
  // I shipped it because Chrome ACCEPTS the constraint: applyConstraints resolves and
  // getSettings() reports `cursor: 'never'` back. That is an API-level check, and it
  // is not the same claim as "the captured pixels lose the pointer" — which is the
  // only claim that mattered. Reported from real use: the mirrored pointer was still
  // there. The constraint is honoured as bookkeeping and ignored by the capturer.
  //
  // Worse than useless, then, because it was not free: it reconfigures a live capture
  // every time the pen is armed or disarmed. Suppressing a duplicate cursor is not
  // worth touching the capture at all, let alone for no effect.
  //
  // If this is ever attempted again, the surface-type branch in useSharePresence is
  // the lever that actually works — don't echo the share back — not a constraint.

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
    // Ink sits ABOVE the video and BELOW every control in the tile. It was at z-20,
    // level with TileActionStack and rendered after it, so an armed canvas — which
    // takes pointer events across the whole tile — covered the very button you use to
    // disarm the pen. Pressing "stop annotating" drew a dot on it instead.
    //
    // The tile's layer scale, low to high: video 0 · ink 5 · name/state pills 10 ·
    // action stack 20 · fullscreen exit 30. A control must never be under the ink.
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-[5]">
      <canvas
        ref={canvasRef}
        data-testid="annotation-canvas"
        // Only the armed pen takes pointer events; otherwise taps fall through to
        // the tile's own spotlight/demote gestures.
        className={canDraw ? 'pointer-events-auto size-full' : 'size-full'}
        style={canDraw ? { touchAction: 'none', cursor } : undefined}
        aria-hidden
      />
    </div>
  )
})
