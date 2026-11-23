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
import {
  opacityForAge,
  isExpired,
  tailTrimForAge,
  chipOpacity,
} from '@/lib/annotate/fade'
import { inkSize, densify, outline, chipTextColor, chipBox, CHIP_PAD_X } from '@/lib/annotate/ink'
import { chunk, type StrokePacket } from '@/lib/annotate/wire'
import { colorVar } from '@/lib/annotate/palette'
import type { Rect } from '@/lib/shareLayout'

/** Simplification tolerance in unit space before a tail goes on the wire. */
const RDP_EPSILON = 0.0015

/** Resample spacing for the ink spline, as a fraction of the ink size. */
const DENSE_SPACING = 0.75

/** Backing-store scale is capped: past 2x the extra pixels cost more than they show. */
const MAX_DPR = 2

const INITIAL_CAPACITY_POINTS = 256

/**
 * Bounds on what a REMOTE sender can make this client allocate.
 *
 * Stroke data is keyed `identity:strokeId`, and strokeId is a u16 off the wire, so
 * without a cap one peer could open 65536 concurrent strokes — a few hundred KB of
 * packets turning into hundreds of MB of buffers here. Expiry alone doesn't cover
 * it: everything inside one ~4s fade window is live at once.
 *
 * Both limits sit far above real drawing. A stroke is a few hundred points, and a
 * fast hand produces maybe a dozen in four seconds; these are 4096 and 64. They're
 * per SENDER, not global, so a flooder can't crowd out anyone else's ink either.
 */
export const MAX_POINTS_PER_STROKE = 4096
export const MAX_STROKES_PER_SENDER = 64

/** Used only if a palette token can't be resolved (engine detached mid-frame). */
const FALLBACK_COLOR = 'oklch(0.7 0.19 25)'

const CHIP_FONT = '600 12px Inter, ui-sans-serif, system-ui, sans-serif'

/**
 * The ink's shadow: the same shape, filled a pixel lower in a translucent dark.
 * It replaces a dark halo stroked at 1.9x the width, which kept light ink legible
 * on pale content but read as a heavy outline everywhere. An offset fill is the
 * cheapest soft shadow there is — `shadowBlur` is a per-draw Gaussian and a CSS
 * `drop-shadow` re-filters the whole canvas every frame, and this loop shares the
 * frame budget with a video decoder.
 */
const SHADOW_COLOR = 'oklch(0.15 0.02 260 / 0.32)'
const SHADOW_DY = 1

/**
 * How long without a new point before a stroke counts as finished and its head
 * tapers. A remote viewer has no pen-up signal, only a pause in packets, so this
 * sits well above a jittery network's gap between frames — a head that tapered
 * and un-tapered on every hiccup would visibly twitch.
 */
const PEN_UP_MS = 400

interface LiveStroke {
  /** Wire id, fixed at creation. Must NOT be read off the engine's current
   *  counter at flush time: a finished stroke can still have an unsent tail when
   *  the next one begins, and would then be broadcast under the new stroke's id. */
  id: number
  points: Float32Array
  /** Number of points written (not the array length). */
  len: number
  colorIdx: number
  /** Author name, shown on a chip beside the pen while they draw. */
  name: string
  /** Timestamp of the most recent point — the fade is measured from here. */
  lastAt: number
  /** How many points have already been transmitted (local strokes only). */
  sent: number
  /** Wire sequence counter for this stroke (local strokes only). */
  seq: number
  local: boolean
  /** Sender identity for remote strokes — lets prune() decrement the right
   *  per-sender count without re-parsing the map key. */
  owner?: string
  /** Cached width of the rendered name; measured once, never changes. */
  labelW?: number
  /** Resampled centre line in PIXEL space (see lib/annotate/ink), and how many
   *  raw points it was built from. Dropped whenever the container resizes. */
  dense?: number[]
  denseLen?: number
  /** Cached filled outline, and the inputs it was built from: raw point count,
   *  how many dense points the tail dissolve has eaten, and whether the head was
   *  tapered. It is rebuilt only when one of those changes — so a stroke that is
   *  simply being held on screen costs no geometry at all. */
  path?: Path2D
  pathLen: number
  pathFrom?: number
  pathComplete?: boolean
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
  /** Live remote stroke count per sender — the budget MAX_STROKES_PER_SENDER caps. */
  private senderStrokes = new Map<string, number>()
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
  /** Resolved palette tokens, keyed by index. Cleared by invalidateColors(). */
  private colorCache = new Map<number, string>()
  /** Chip text colour per palette index — derived from colorCache, cleared with it. */
  private chipTextCache = new Map<number, string>()
  /** Reduced motion swaps the tail dissolve for a plain fade. Read per frame
   *  (`.matches` is a cached flag), so changing the OS setting applies at once. */
  private readonly reducedMotion: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null

  private readonly onFlush: (packet: StrokePacket) => void
  private readonly now: () => number

  constructor(opts: EngineOptions) {
    this.onFlush = opts.onFlush
    this.now = opts.now ?? (() => performance.now())
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement) {
    // destroy() must NOT be terminal. React StrictMode (and any remount) runs an
    // effect's cleanup and then re-runs the effect against the SAME memoised
    // engine — mount → destroy → attach. Without reviving here the engine stays
    // disposed after that double-invoke, wake() no-ops forever and nothing ever
    // paints, which silently kills the whole feature in development.
    this.disposed = false
    this.canvas = canvas
    // `desynchronized` lets the compositor skip a frame of latency on the ink.
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    this.applyCanvasSize()
    if (this.strokes.size > 0) this.wake()
  }

  detach() {
    this.stopLoop()
    this.canvas = null
    this.ctx = null
  }

  destroy() {
    this.disposed = true
    this.strokes.clear()
    this.senderStrokes.clear()
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
    // Unit coords are resolution-independent, so the DATA needs no remapping —
    // but the cached Path2Ds are in pixel space, so they must be rebuilt.
    for (const s of this.strokes.values()) {
      s.path = undefined
      s.pathLen = 0
      s.dense = undefined
    }
    // Resizing the backing store also clears it, so anything live must repaint.
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
      pathLen: 0,
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
    // Remote strokes are bounded; the local one is bounded by the hand holding
    // the mouse, and truncating it mid-gesture would be visible.
    if (!stroke.local && stroke.len >= MAX_POINTS_PER_STROKE) return
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
      const live = this.senderStrokes.get(identity) ?? 0
      if (live >= MAX_STROKES_PER_SENDER) return
      const n = packet.points.length >> 1
      stroke = {
        id: packet.strokeId,
        // n is a POINT count; the buffer holds two floats per point. (This read
        // packet.points.length — already 2n — against a point-count constant, and
        // so allocated twice what it needed.)
        points: new Float32Array(Math.max(INITIAL_CAPACITY_POINTS, n) * 2),
        len: 0,
        colorIdx: packet.colorIdx,
        name,
        lastAt: this.now(),
        sent: 0,
        seq: packet.seq,
        local: false,
        owner: identity,
        pathLen: 0,
      }
      this.strokes.set(key, stroke)
      this.senderStrokes.set(identity, live + 1)
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
    this.senderStrokes.clear()
    this.localKey = null
    this.wake()
  }

  /** Are any strokes currently visible? Drives the overlay's pointer-events. */
  get hasInk(): boolean {
    return this.strokes.size > 0
  }

  /** Live stroke count. Diagnostic — it exists so the remote-input bounds can be
   *  asserted rather than assumed. */
  get liveStrokes(): number {
    return this.strokes.size
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
      if (!isExpired(now - s.lastAt)) continue
      this.strokes.delete(key)
      if (s.owner) {
        const left = (this.senderStrokes.get(s.owner) ?? 1) - 1
        if (left > 0) this.senderStrokes.set(s.owner, left)
        else this.senderStrokes.delete(s.owner)
      }
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

    const size = inkSize(rect.w, rect.h)
    const dissolve = !this.reducedMotion?.matches
    // Newest stroke per REMOTE author — each gets one chip, however many strokes
    // they have on screen. Your own pen gets none: you know it's you.
    const chips = new Map<string, { stroke: LiveStroke; age: number }>()

    for (const [key, stroke] of this.strokes) {
      if (stroke.len === 0) continue
      const age = now - stroke.lastAt
      const drawing = key === this.localKey
      // Clean-up is a fade-out, and — unless reduced motion is on — the stroke
      // is also eaten from its first point as it fades, like a laser trail.
      // Same lifetime either way.
      const trim = dissolve && !drawing ? tailTrimForAge(age) : 0
      const alpha = opacityForAge(age)
      if (alpha <= 0) continue
      // The head tapers once the pen has (as far as anyone can tell) lifted.
      const complete = !drawing && age > PEN_UP_MS
      const path = this.pathFor(stroke, rect, size, trim, complete)
      ctx.globalAlpha = alpha
      ctx.translate(0, SHADOW_DY)
      ctx.fillStyle = SHADOW_COLOR
      ctx.fill(path)
      ctx.translate(0, -SHADOW_DY)
      ctx.fillStyle = this.strokeColor(stroke.colorIdx)
      ctx.fill(path)

      if (!stroke.local && stroke.owner && stroke.name) {
        const prev = chips.get(stroke.owner)
        if (!prev || age < prev.age) chips.set(stroke.owner, { stroke, age })
      }
    }

    for (const { stroke, age } of chips.values()) this.drawChip(ctx, stroke, age, rect)
    ctx.globalAlpha = 1
  }

  /**
   * The stroke's filled outline as a Path2D, CACHED.
   *
   * Every live stroke repaints every frame (it is fading), so the geometry must
   * not be rebuilt every frame too — three people scribbling for a few seconds was
   * measured at ~82% decode retention before paths were cached. The outline does
   * depend on the whole stroke (perfect-freehand smooths along it), so it can't be
   * EXTENDED the way a lineTo polyline could; instead it is rebuilt only when its
   * inputs change: a new point, a step of the tail dissolve, or the head taper
   * once the pen lifts. A stroke being held on screen costs nothing.
   *
   * The cache is pixel-space, so setGeometry drops it on resize.
   */
  private pathFor(stroke: LiveStroke, rect: Rect, size: number, trim: number, complete: boolean): Path2D {
    if (!stroke.dense || stroke.denseLen !== stroke.len) {
      const px = new Array<number>(stroke.len * 2)
      for (let i = 0; i < stroke.len; i++) {
        const p = fromUnit({ x: stroke.points[i * 2], y: stroke.points[i * 2 + 1] }, rect)
        px[i * 2] = p.x
        px[i * 2 + 1] = p.y
      }
      stroke.dense = densify(px, stroke.len, size * DENSE_SPACING)
      stroke.denseLen = stroke.len
    }
    const dense = stroke.dense
    const n = dense.length >> 1
    const from = Math.min(n - 1, Math.floor(trim * n))
    if (
      stroke.path &&
      stroke.pathLen === stroke.len &&
      stroke.pathFrom === from &&
      stroke.pathComplete === complete
    ) {
      return stroke.path
    }
    const shape = outline(dense, from, size, complete)
    const path = new Path2D()
    if (shape.length < 3) {
      // A tap with no drag: a round dot at the pen.
      path.arc(dense[from * 2], dense[from * 2 + 1], size / 2, 0, Math.PI * 2)
    } else {
      // Quadratic curves through the outline's midpoints — the smooth closed
      // shape perfect-freehand's own docs draw.
      path.moveTo(shape[0][0], shape[0][1])
      for (let i = 0; i < shape.length; i++) {
        const a = shape[i]
        const b = shape[(i + 1) % shape.length]
        path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      }
      path.closePath()
    }
    stroke.path = path
    stroke.pathLen = stroke.len
    stroke.pathFrom = from
    stroke.pathComplete = complete
    return path
  }

  /**
   * Resolve the author's palette token to a real colour, CACHED.
   *
   * The value is read off the element so theme presets (including the
   * Deuteranopia/Tritanopia sets) apply without the engine knowing anything about
   * theming, and so no colour is hardcoded here. But getComputedStyle forces a
   * style recalculation, and this is called per stroke per frame — uncached it
   * would be one of the most expensive things in the render loop. Tokens only
   * change when the theme does, so the cache is cleared by invalidateColors().
   */
  private strokeColor(colorIdx: number): string {
    const cached = this.colorCache.get(colorIdx)
    if (cached) return cached
    const el = this.canvas
    if (!el) return FALLBACK_COLOR
    const value = getComputedStyle(el).getPropertyValue(colorVar(colorIdx)).trim() || FALLBACK_COLOR
    this.colorCache.set(colorIdx, value)
    return value
  }

  private chipText(colorIdx: number): string {
    const cached = this.chipTextCache.get(colorIdx)
    if (cached) return cached
    const value = chipTextColor(this.strokeColor(colorIdx))
    this.chipTextCache.set(colorIdx, value)
    return value
  }

  /** Drop cached palette colours — call when the theme or accent preset changes. */
  invalidateColors() {
    this.colorCache.clear()
    this.chipTextCache.clear()
    if (this.strokes.size > 0) this.wake()
  }

  /**
   * One name chip per remote author, filled in their colour, following their pen
   * while they draw and gone about a second after they stop.
   *
   * It replaced a name drawn at the head of EVERY stroke, outlined in dark: three
   * strokes from one person put their name on the slide three times, while the
   * colour already said whose ink was whose. The chip is still the second
   * attribution channel STYLE.md §6 asks for (never colour alone) at the moment it
   * matters — while the ink is appearing — and the Announcer is the third.
   *
   * Drawn on the canvas rather than as a React node: it follows the pointer, so a
   * DOM element would mean a re-render every frame — the exact cost this design
   * avoids.
   */
  private drawChip(ctx: CanvasRenderingContext2D, stroke: LiveStroke, age: number, rect: Rect) {
    const alpha = chipOpacity(age)
    if (alpha <= 0) return
    const head = fromUnit(
      { x: stroke.points[(stroke.len - 1) * 2], y: stroke.points[(stroke.len - 1) * 2 + 1] },
      rect,
    )
    ctx.font = CHIP_FONT
    ctx.textBaseline = 'middle'
    // Measured once per stroke — the name can't change, and measureText in a
    // per-frame loop is not free.
    if (stroke.labelW === undefined) stroke.labelW = ctx.measureText(stroke.name).width
    const box = chipBox(head.x, head.y, stroke.labelW, rect)
    ctx.globalAlpha = alpha
    ctx.fillStyle = SHADOW_COLOR
    this.pill(ctx, box.x, box.y + SHADOW_DY, box.w, box.h)
    ctx.fillStyle = this.strokeColor(stroke.colorIdx)
    this.pill(ctx, box.x, box.y, box.w, box.h)
    ctx.fillStyle = this.chipText(stroke.colorIdx)
    ctx.fillText(stroke.name, box.x + CHIP_PAD_X, box.y + box.h / 2 + 0.5)
  }

  private pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, h / 2)
    else ctx.rect(x, y, w, h)
    ctx.fill()
  }
}
