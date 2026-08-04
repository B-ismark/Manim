/**
 * Owns ALL annotation stroke data and ALL canvas drawing.
 *
 * Deliberately a plain class with no React import. Strokes never enter component
 * state or a Zustand store, because a pointer produces 100+ points per second and
 * anything reactive would re-render PresentationStage on every one of them —
 * while a video decoder is already running. React's only jobs here are mounting
 * the canvas and telling the engine its geometry.
 *
 * PERFORMANCE RULES (in priority order):
 *  1. The rAF loop PARKS when nothing is alive. A permanently-running loop
 *     competes with the share's decoder for frames, which is exactly the jank
 *     this design exists to avoid. Strokes auto-expire, so idle is the norm.
 *  2. Pointer handling never draws and never sends. It appends to a preallocated
 *     Float32Array and wakes the frame loop; the frame does the work.
 *  3. Points are stored as flat Float32Array (~8 bytes/point), not {x,y} objects
 *     (~80 bytes/point), and grown by doubling rather than per-point push.
 */

import { contentRect, toUnit, fromUnit, type Point } from '@/lib/annotate/geometry'
import { simplify } from '@/lib/annotate/rdp'
import { opacityForAge, isExpired } from '@/lib/annotate/fade'
import { chunk, type StrokePacket } from '@/lib/annotate/wire'
import { colorVar } from '@/lib/annotate/palette'
import type { Rect } from '@/lib/shareLayout'

/** Simplification tolerance in unit space before a tail goes on the wire. */
const RDP_EPSILON = 0.0015

/** Stroke width as a fraction of the content box's smaller side (resolution-independent). */
const STROKE_WIDTH_FRACTION = 0.004
const MIN_STROKE_PX = 2.5
const MAX_STROKE_PX = 7

/** Backing-store scale is capped: past 2x the extra pixels cost more than they show. */
const MAX_DPR = 2

const INITIAL_CAPACITY_POINTS = 256

interface LiveStroke {
  /** Wire id, fixed at creation. Must NOT be read off the engine's current
   *  counter at flush time: a finished stroke can still have an unsent tail when
   *  the next one begins, and would then be broadcast under the new stroke's id. */
  id: number
  points: Float32Array
  /** Number of points written (not the array length). */
  len: number
  colorIdx: number
  /** Author label, drawn beside the stroke head while it's live. */
  name: string
  /** Timestamp of the most recent point — the fade is measured from here. */
  lastAt: number
  /** How many points have already been transmitted (local strokes only). */
  sent: number
  /** Wire sequence counter for this stroke (local strokes only). */
  seq: number
  local: boolean
}

export interface EngineOptions {
  /** Called on the animation frame with a packet ready to broadcast. */
  onFlush: (packet: StrokePacket) => void
  /** Wall clock, injectable for tests. */
  now?: () => number
}

export class AnnotationEngine {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  /** Keyed `${identity}:${strokeId}` so two peers can draw concurrently. */
  private strokes = new Map<string, LiveStroke>()
  private localKey: string | null = null
  private localStrokeId = 0
  private localColorIdx = 0
  private localName = ''

  private boxW = 0
  private boxH = 0
  private aspect = 16 / 9
  private dpr = 1

  private raf = 0
  private disposed = false

  private readonly onFlush: (packet: StrokePacket) => void
  private readonly now: () => number

  constructor(opts: EngineOptions) {
    this.onFlush = opts.onFlush
    this.now = opts.now ?? (() => performance.now())
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    // `desynchronized` lets the compositor skip a frame of latency on the ink.
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    this.applyCanvasSize()
  }

  detach() {
    this.stopLoop()
    this.canvas = null
    this.ctx = null
  }

  destroy() {
    this.disposed = true
    this.strokes.clear()
    this.detach()
  }

  // ── geometry ─────────────────────────────────────────────────────────────

  /**
   * Container box, the share's intrinsic aspect, and the device pixel ratio.
   * Called from React on resize — cheap and idempotent, so a spurious call is
   * harmless, but it does force a redraw since every stroke's pixel position moves.
   */
  setGeometry(width: number, height: number, aspect: number, dpr = window.devicePixelRatio || 1) {
    const nextDpr = Math.min(dpr, MAX_DPR)
    if (this.boxW === width && this.boxH === height && this.aspect === aspect && this.dpr === nextDpr) {
      return
    }
    this.boxW = width
    this.boxH = height
    this.aspect = aspect
    this.dpr = nextDpr
    this.applyCanvasSize()
    // Unit coords are resolution-independent, so nothing needs remapping — but
    // resizing the backing store clears it, so anything live must be repainted.
    if (this.strokes.size > 0) this.wake()
  }

  private applyCanvasSize() {
    const c = this.canvas
    if (!c || !(this.boxW > 0) || !(this.boxH > 0)) return
    const w = Math.round(this.boxW * this.dpr)
    const h = Math.round(this.boxH * this.dpr)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  /** The painted video's box inside the container (excludes letterbox bars). */
  private content(): Rect {
    return contentRect(this.boxW, this.boxH, this.aspect)
  }

  // ── local drawing ────────────────────────────────────────────────────────

  setLocalAuthor(colorIdx: number, name: string) {
    this.localColorIdx = colorIdx
    this.localName = name
  }

  /**
   * Start a stroke at a container-relative pixel. Returns false if the point is
   * outside the painted video — the letterbox bars aren't shared content, so a
   * stroke there would be meaningless on every other screen.
   */
  beginLocal(p: Point, identity: string): boolean {
    const rect = this.content()
    if (!(rect.w > 0) || !(rect.h > 0)) return false
    if (p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.h) return false

    this.localStrokeId = (this.localStrokeId + 1) & 0xffff
    this.localKey = `${identity}:${this.localStrokeId}`
    const stroke: LiveStroke = {
      id: this.localStrokeId,
      points: new Float32Array(INITIAL_CAPACITY_POINTS * 2),
      len: 0,
      colorIdx: this.localColorIdx,
      name: this.localName,
      lastAt: this.now(),
      sent: 0,
      seq: 0,
      local: true,
    }
    this.strokes.set(this.localKey, stroke)
    this.appendUnit(stroke, toUnit(p, rect))
    this.wake()
    return true
  }

  /**
   * Append pointer samples to the live local stroke. Takes an array because
   * `getCoalescedEvents()` hands back every sample the device produced since the
   * last frame — using them all is what makes the local curve smooth.
   */
  extendLocal(points: readonly Point[]) {
    const stroke = this.localKey ? this.strokes.get(this.localKey) : null
    if (!stroke) return
    const rect = this.content()
    if (!(rect.w > 0)) return
    for (const p of points) this.appendUnit(stroke, toUnit(p, rect))
    stroke.lastAt = this.now()
    this.wake()
  }

  endLocal() {
    // Nothing to finalise: the fade owns the stroke's lifetime from here, and
    // the next frame flushes whatever tail is still unsent.
    this.localKey = null
    this.wake()
  }

  private appendUnit(stroke: LiveStroke, u: Point) {
    if (stroke.len * 2 + 2 > stroke.points.length) {
      const grown = new Float32Array(stroke.points.length * 2)
      grown.set(stroke.points)
      stroke.points = grown
    }
    stroke.points[stroke.len * 2] = u.x
    stroke.points[stroke.len * 2 + 1] = u.y
    stroke.len++
  }

  // ── remote strokes ───────────────────────────────────────────────────────

  /**
   * Merge an inbound packet. `identity` is the SFU-attributed sender, never a
   * payload field — that's what makes attribution unspoofable.
   *
   * Calls no setState: a packet costs zero React renders, and the frame loop
   * coalesces packets from every peer into a single repaint.
   */
  ingest(identity: string, packet: StrokePacket, name: string) {
    if (this.disposed) return
    const key = `${identity}:${packet.strokeId}`
    let stroke = this.strokes.get(key)
    if (!stroke) {
      stroke = {
        id: packet.strokeId,
        points: new Float32Array(Math.max(INITIAL_CAPACITY_POINTS, packet.points.length) * 2),
        len: 0,
        colorIdx: packet.colorIdx,
        name,
        lastAt: this.now(),
        sent: 0,
        seq: packet.seq,
        local: false,
      }
      this.strokes.set(key, stroke)
    }
    const n = packet.points.length >> 1
    // Packets overlap by one point so segments join; skip the duplicate when
    // continuing a stroke we already have.
    const from = stroke.len > 0 ? 1 : 0
    for (let i = from; i < n; i++) {
      this.appendUnit(stroke, { x: packet.points[i * 2], y: packet.points[i * 2 + 1] })
    }
    stroke.lastAt = this.now()
    this.wake()
  }

  clearAll() {
    this.strokes.clear()
    this.localKey = null
    this.wake()
  }

  /** Are any strokes currently visible? Drives the overlay's pointer-events. */
  get hasInk(): boolean {
    return this.strokes.size > 0
  }

  // ── frame loop ───────────────────────────────────────────────────────────

  /**
   * Ensure the frame loop is running. There is no dirty FLAG: a live stroke's
   * opacity changes every frame, so "some stroke exists" is exactly the
   * condition for needing a repaint. Waking an already-running loop is a no-op.
   */
  private wake() {
    if (!this.raf && !this.disposed) {
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame = () => {
    this.raf = 0
    if (this.disposed) return

    const now = this.now()
    this.prune(now)
    this.flush()
    this.draw(now)

    // Keep going only while something is still visible — a live stroke's opacity
    // changes every frame, so "alive" means "needs redrawing". When the last one
    // expires the loop parks and costs nothing until the next pointer or packet.
    if (this.strokes.size > 0) {
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private prune(now: number) {
    for (const [key, s] of this.strokes) {
      // The stroke being drawn right now never expires mid-gesture.
      if (key === this.localKey) continue
      if (isExpired(now - s.lastAt)) this.strokes.delete(key)
    }
  }

  /** Send whatever the local stroke has produced since the last frame. */
  private flush() {
    for (const s of this.strokes.values()) {
      if (!s.local || s.len <= s.sent) continue
      // Re-send the last already-sent point so the receiver's segments connect.
      const from = s.sent > 0 ? s.sent - 1 : 0
      const tail = s.points.slice(from * 2, s.len * 2)
      const reduced = simplify(tail, RDP_EPSILON)
      for (const packet of chunk(reduced, s.colorIdx, s.id, s.seq)) {
        this.onFlush(packet)
        s.seq = (packet.seq + 1) & 0xffff
      }
      s.sent = s.len
    }
  }

  private draw(now: number) {
    const ctx = this.ctx
    if (!ctx || !(this.boxW > 0)) return
    const rect = this.content()
    if (!(rect.w > 0)) return

    ctx.clearRect(0, 0, this.boxW, this.boxH)
    if (this.strokes.size === 0) return

    const width = Math.max(
      MIN_STROKE_PX,
      Math.min(MAX_STROKE_PX, Math.min(rect.w, rect.h) * STROKE_WIDTH_FRACTION),
    )
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const stroke of this.strokes.values()) {
      const alpha = opacityForAge(now - stroke.lastAt)
      if (alpha <= 0 || stroke.len === 0) continue
      ctx.globalAlpha = alpha
      this.path(ctx, stroke, rect)
      // Dark halo first so a light stroke stays legible over pale shared content
      // (a spreadsheet) just as a dark one does over an IDE.
      ctx.lineWidth = width * 1.9
      ctx.strokeStyle = 'oklch(0.15 0 0 / 0.45)'
      ctx.stroke()
      ctx.lineWidth = width
      ctx.strokeStyle = this.strokeColor(stroke.colorIdx)
      ctx.stroke()
      this.drawLabel(ctx, stroke, rect)
    }
    ctx.globalAlpha = 1
  }

  private path(ctx: CanvasRenderingContext2D, stroke: LiveStroke, rect: Rect) {
    ctx.beginPath()
    const first = fromUnit({ x: stroke.points[0], y: stroke.points[1] }, rect)
    if (stroke.len === 1) {
      // A tap with no drag still deserves a dot.
      ctx.moveTo(first.x, first.y)
      ctx.lineTo(first.x + 0.01, first.y)
      return
    }
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < stroke.len; i++) {
      const p = fromUnit({ x: stroke.points[i * 2], y: stroke.points[i * 2 + 1] }, rect)
      ctx.lineTo(p.x, p.y)
    }
  }

  /**
   * Resolve the author's palette token to a real colour. Read from the element so
   * theme presets (including the Deuteranopia/Tritanopia sets) apply without the
   * engine knowing anything about theming — and so no colour is hardcoded here.
   */
  private strokeColor(colorIdx: number): string {
    const el = this.canvas
    if (!el) return 'oklch(0.7 0.19 25)'
    const value = getComputedStyle(el).getPropertyValue(colorVar(colorIdx)).trim()
    return value || 'oklch(0.7 0.19 25)'
  }

  /**
   * Author name beside the stroke head.
   *
   * Drawn on the canvas rather than rendered as React nodes: a label follows the
   * pointer, so a DOM element would mean a re-render every frame — the exact cost
   * this design avoids. On canvas it also inherits the stroke's fade for free.
   *
   * This is the second attribution channel required by STYLE.md §6 (never encode
   * meaning in colour alone); the Announcer provides the third for screen readers.
   */
  private drawLabel(ctx: CanvasRenderingContext2D, stroke: LiveStroke, rect: Rect) {
    if (!stroke.name || stroke.len === 0) return
    const head = fromUnit(
      { x: stroke.points[(stroke.len - 1) * 2], y: stroke.points[(stroke.len - 1) * 2 + 1] },
      rect,
    )
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const pad = 10
    // Flip to the left of the head when close to the right edge so the label
    // never runs off the shared content.
    const w = ctx.measureText(stroke.name).width
    const x = head.x + pad + w > rect.x + rect.w ? head.x - pad - w : head.x + pad
    const y = head.y - pad
    ctx.lineWidth = 3
    ctx.strokeStyle = 'oklch(0.15 0 0 / 0.55)'
    ctx.strokeText(stroke.name, x, y)
    ctx.fillStyle = this.strokeColor(stroke.colorIdx)
    ctx.fillText(stroke.name, x, y)
  }
}
