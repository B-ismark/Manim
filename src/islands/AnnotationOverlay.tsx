import { memo, useEffect, useRef, useState } from 'react'
import { useAnnotate } from '@/features/annotate/useAnnotate'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useElementSize } from '@/lib/useElementSize'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useThemeStore } from '@/store/useThemeStore'
import { useSharePresence } from '@/lib/useSharePresence'
import { penCursor, setCapturedCursorHidden } from '@/features/annotate/penCursor'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
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
  const { engine, beginLocal, localColorIdx } = useAnnotate()
  const active = useAnnotateStore((s) => s.active)
  const announce = useAnnounce()
  const { ref: boxRef, size } = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // One shared answer to "is drawing possible right now" — the same value the two
  // pen buttons render on and the same one that disarms the pen. This used to be
  // re-derived here from `allowed && !touch`, which is most of that condition but
  // not all of it, and the gap is how an armed pen outlived its own canvas.
  const { canAnnotate, ownShareShown } = useSharePresence()
  const canDraw = active && canAnnotate

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

  // The armed cursor, in this author's own palette colour.
  //
  // Resolved from the CSS custom property rather than hardcoded (STYLE.md §1), and
  // re-resolved whenever the theme rewrites the palette — the same invalidation the
  // engine's own colour cache needs, for the same reason.
  const { localParticipant } = useLocalParticipant()
  const [cursor, setCursor] = useState('crosshair')
  useEffect(() => {
    if (!canDraw) return
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(colorVar(localColorIdx))
      .trim()
    setCursor(resolved ? penCursor(resolved) : 'crosshair')
  }, [canDraw, localColorIdx, themeMode, accentId, highContrast])

  // Hide the OS pointer from the OUTGOING capture while the pen is armed on your
  // OWN share. This is the other half of the doubled-cursor fix: not echoing a
  // monitor share removes the duplicate for the default case, and this removes it
  // for anyone who has deliberately turned the echo back on.
  //
  // Scoped to "armed", not the whole share, because the presenter's pointer is what
  // viewers follow during a walkthrough — but while a stroke is being drawn the ink
  // says everything the arrow would, and in an attributed colour.
  const shareMst = (
    localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track as
      | LocalVideoTrack
      | undefined
  )?.mediaStreamTrack
  useEffect(() => {
    if (!shareMst) return
    const hide = canDraw && ownShareShown
    setCapturedCursorHidden(shareMst, hide)
    // Always hand the cursor back on the way out — disarming, unmounting, or the
    // share ending must not leave viewers with a pointerless capture.
    return () => setCapturedCursorHidden(shareMst, false)
  }, [shareMst, canDraw, ownShareShown])

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
        className={canDraw ? 'pointer-events-auto size-full' : 'size-full'}
        style={canDraw ? { touchAction: 'none', cursor } : undefined}
        aria-hidden
      />
    </div>
  )
})
