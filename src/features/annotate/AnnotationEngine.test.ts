import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AnnotationEngine,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_SENDER,
} from './AnnotationEngine'
import type { StrokePacket } from '@/lib/annotate/wire'
import { LIFETIME_MS } from '@/lib/annotate/fade'

/**
 * Engine behaviour without a browser. Vitest runs in Node here (see
 * vitest.config.ts), so the handful of DOM APIs the engine touches are stubbed:
 * a canvas whose 2D context records nothing, a manually-pumped rAF, and a
 * getComputedStyle that returns a palette value.
 *
 * The rAF stub is manual on purpose — the frame loop's park/resume behaviour is
 * one of the things under test, so frames must be advanced explicitly rather
 * than by a timer.
 */

let frameQueue: FrameRequestCallback[] = []
let clock = 0
/** Total lineTo calls across all Path2D instances — the per-frame path cost. */
let pathLineTos = 0

/** Node has no Path2D; this records the geometry work the engine issues. */
class FakePath2D {
  moveTo() {}
  lineTo() {
    pathLineTos++
  }
}

/** Run exactly one pending frame, as the browser would. */
function pumpFrame() {
  const pending = frameQueue
  frameQueue = []
  for (const cb of pending) cb(clock)
}

function fakeCanvas() {
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textBaseline: '',
    globalAlpha: 1,
  }
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    __ctx: ctx,
  } as unknown as HTMLCanvasElement & { __ctx: typeof ctx }
}

/** Engine attached to a 1600x900 box showing a 16:9 share (no letterbox bars). */
function makeEngine(onFlush: (p: StrokePacket) => void = () => {}) {
  const engine = new AnnotationEngine({ onFlush, now: () => clock })
  const canvas = fakeCanvas()
  engine.attach(canvas)
  engine.setGeometry(1600, 900, 16 / 9, 1)
  engine.setLocalAuthor(3, 'Ada')
  return { engine, canvas }
}

beforeEach(() => {
  frameQueue = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb)
    return frameQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'oklch(0.5 0.1 200)' }))
  vi.stubGlobal('Path2D', FakePath2D)
  pathLineTos = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('beginLocal bounds', () => {
  it('accepts a point inside the painted video', () => {
    const { engine } = makeEngine()
    expect(engine.beginLocal({ x: 800, y: 450 }, 'Ada#1')).toBe(true)
  })

  it('rejects a point in the letterbox bars', () => {
    const engine = new AnnotationEngine({ onFlush: () => {}, now: () => clock })
    engine.attach(fakeCanvas())
    // 16:9 content in a square box → bars top and bottom.
    engine.setGeometry(900, 900, 16 / 9, 1)
    expect(engine.beginLocal({ x: 450, y: 5 }, 'Ada#1')).toBe(false)
    expect(engine.beginLocal({ x: 450, y: 450 }, 'Ada#1')).toBe(true)
  })

  it('rejects before geometry is known (container still 0x0)', () => {
    const engine = new AnnotationEngine({ onFlush: () => {}, now: () => clock })
    engine.attach(fakeCanvas())
    expect(engine.beginLocal({ x: 10, y: 10 }, 'Ada#1')).toBe(false)
  })
})

describe('flush / wire output', () => {
  it('broadcasts points drawn since the last frame', () => {
    const sent: StrokePacket[] = []
    const { engine } = makeEngine((p) => sent.push(p))
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.extendLocal([
      { x: 200, y: 200 },
      { x: 300, y: 100 },
    ])
    expect(sent).toHaveLength(0) // nothing sent from the pointer path itself
    pumpFrame()
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[0].colorIdx).toBe(3)
  })

  it('sends nothing when there is nothing new', () => {
    const sent: StrokePacket[] = []
    const { engine } = makeEngine((p) => sent.push(p))
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    pumpFrame()
    const after = sent.length
    pumpFrame()
    expect(sent).toHaveLength(after)
  })

  it('REGRESSION: a stroke keeps its own id when a new stroke starts before the frame', () => {
    // The bug: flush() read the engine's CURRENT stroke counter, so a finished
    // stroke still holding an unsent tail was broadcast under the NEXT stroke's
    // id — splicing two unrelated strokes together on every receiver.
    const sent: StrokePacket[] = []
    const { engine } = makeEngine((p) => sent.push(p))

    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.extendLocal([{ x: 150, y: 150 }])
    engine.endLocal()
    // Second stroke begins before any frame has run.
    engine.beginLocal({ x: 400, y: 400 }, 'Ada#1')
    engine.extendLocal([{ x: 450, y: 450 }])
    pumpFrame()

    const ids = new Set(sent.map((p) => p.strokeId))
    expect(ids.size).toBe(2) // two distinct strokes on the wire, not one merged
  })

  it('gives every stroke a distinct id', () => {
    const sent: StrokePacket[] = []
    const { engine } = makeEngine((p) => sent.push(p))
    for (let i = 0; i < 3; i++) {
      engine.beginLocal({ x: 100 + i * 10, y: 100 }, 'Ada#1')
      engine.extendLocal([{ x: 200 + i * 10, y: 200 }])
      engine.endLocal()
      pumpFrame()
    }
    expect(new Set(sent.map((p) => p.strokeId)).size).toBe(3)
  })
})

describe('ingest (remote strokes)', () => {
  const packet = (points: number[], strokeId = 7, seq = 0): StrokePacket => ({
    colorIdx: 2,
    strokeId,
    seq,
    target: 0,
    points: Float32Array.from(points),
  })

  it('accepts a remote stroke and keeps it alive', () => {
    const { engine } = makeEngine()
    engine.ingest('Bo#2', packet([0.1, 0.1, 0.2, 0.2]), 'Bo')
    expect(engine.hasInk).toBe(true)
  })

  it('never re-broadcasts a remote stroke', () => {
    // Echoing peers' strokes back would multiply traffic with every participant.
    const sent: StrokePacket[] = []
    const { engine } = makeEngine((p) => sent.push(p))
    engine.ingest('Bo#2', packet([0.1, 0.1, 0.2, 0.2]), 'Bo')
    pumpFrame()
    expect(sent).toHaveLength(0)
  })

  it('keeps concurrent authors separate', () => {
    const { engine } = makeEngine()
    engine.ingest('Bo#2', packet([0.1, 0.1], 1), 'Bo')
    engine.ingest('Cy#3', packet([0.5, 0.5], 1), 'Cy')
    // Same strokeId from different senders must not collide.
    engine.ingest('Bo#2', packet([0.2, 0.2], 1, 1), 'Bo')
    expect(engine.hasInk).toBe(true)
    clock += LIFETIME_MS + 1
    pumpFrame()
    expect(engine.hasInk).toBe(false)
  })

  it('survives a packet whose opening point was dropped', () => {
    const { engine } = makeEngine()
    // seq 1 arrives first (seq 0 lost). It must still start a stroke, not throw.
    expect(() => engine.ingest('Bo#2', packet([0.3, 0.3, 0.4, 0.4], 9, 1), 'Bo')).not.toThrow()
    expect(engine.hasInk).toBe(true)
  })
})

describe('fade and the frame loop', () => {
  it('drops a stroke once it expires', () => {
    const { engine } = makeEngine()
    engine.ingest(
      'Bo#2',
      { colorIdx: 1, strokeId: 1, seq: 0, target: 0, points: Float32Array.from([0.1, 0.1]) },
      'Bo',
    )
    expect(engine.hasInk).toBe(true)
    clock += LIFETIME_MS + 1
    pumpFrame()
    expect(engine.hasInk).toBe(false)
  })

  it('PARKS the loop when everything has expired', () => {
    // The core performance property: an idle engine must not keep asking for
    // frames, or it competes with the share's video decoder forever.
    const { engine } = makeEngine()
    engine.ingest(
      'Bo#2',
      { colorIdx: 1, strokeId: 1, seq: 0, target: 0, points: Float32Array.from([0.1, 0.1]) },
      'Bo',
    )
    pumpFrame()
    expect(frameQueue.length).toBe(1) // still alive → still scheduling

    clock += LIFETIME_MS + 1
    pumpFrame()
    expect(frameQueue.length).toBe(0) // expired → parked
  })

  it('resumes after parking when new ink arrives', () => {
    const { engine } = makeEngine()
    engine.ingest(
      'Bo#2',
      { colorIdx: 1, strokeId: 1, seq: 0, target: 0, points: Float32Array.from([0.1, 0.1]) },
      'Bo',
    )
    clock += LIFETIME_MS + 1
    pumpFrame()
    expect(frameQueue.length).toBe(0)

    engine.ingest(
      'Cy#3',
      { colorIdx: 2, strokeId: 2, seq: 0, target: 0, points: Float32Array.from([0.5, 0.5]) },
      'Cy',
    )
    expect(frameQueue.length).toBe(1)
  })

  it('does not expire the stroke currently being drawn', () => {
    // A slow deliberate stroke must not dissolve from under the pen.
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    clock += LIFETIME_MS * 3
    pumpFrame()
    expect(engine.hasInk).toBe(true)
  })
})

describe('lifecycle', () => {
  it('clearAll removes everything', () => {
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.clearAll()
    expect(engine.hasInk).toBe(false)
  })

  it('stops scheduling frames after destroy', () => {
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.destroy()
    frameQueue = []
    engine.ingest(
      'Bo#2',
      { colorIdx: 1, strokeId: 1, seq: 0, target: 0, points: Float32Array.from([0.1, 0.1]) },
      'Bo',
    )
    expect(frameQueue.length).toBe(0)
  })

  it('REGRESSION: survives a StrictMode-style destroy → re-attach', () => {
    // React StrictMode runs effect cleanup then re-runs the effect against the
    // SAME memoised engine. If destroy() were terminal the engine would be dead
    // after mount, and nothing would ever paint — which is exactly what happened
    // in the browser while every single-attach unit test still passed.
    const engine = new AnnotationEngine({ onFlush: () => {}, now: () => clock })
    const canvas = fakeCanvas()
    engine.attach(canvas)
    engine.setGeometry(1600, 900, 16 / 9, 1)

    engine.destroy() // StrictMode cleanup

    engine.attach(canvas) // StrictMode re-mount, same instance
    engine.setGeometry(1600, 900, 16 / 9, 1)
    engine.setLocalAuthor(0, 'Ada')

    expect(engine.beginLocal({ x: 800, y: 450 }, 'Ada#1')).toBe(true)
    expect(frameQueue.length).toBeGreaterThan(0) // the loop woke up again
    pumpFrame()
    expect(canvas.__ctx.stroke).toHaveBeenCalled() // and it actually painted
  })

  it('tolerates pointer input after detach', () => {
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.detach()
    expect(() => {
      engine.extendLocal([{ x: 200, y: 200 }])
      pumpFrame()
    }).not.toThrow()
  })
})

describe('geometry and rendering', () => {
  it('sizes the backing store by DPR, capped at 2', () => {
    const engine = new AnnotationEngine({ onFlush: () => {}, now: () => clock })
    const canvas = fakeCanvas()
    engine.attach(canvas)
    engine.setGeometry(800, 600, 4 / 3, 3) // request 3x
    expect(canvas.width).toBe(1600) // capped at 2x
    expect(canvas.height).toBe(1200)
  })

  it('resolves each palette colour once and caches it', () => {
    // getComputedStyle forces a style recalc; called per stroke per frame it
    // would be the most expensive thing in the render loop.
    const spy = vi.fn(() => ({ getPropertyValue: () => 'oklch(0.5 0.1 200)' }))
    vi.stubGlobal('getComputedStyle', spy)
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.extendLocal([{ x: 200, y: 200 }])
    pumpFrame()
    pumpFrame()
    pumpFrame()
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('re-resolves colours after invalidateColors (theme change)', () => {
    const spy = vi.fn(() => ({ getPropertyValue: () => 'oklch(0.5 0.1 200)' }))
    vi.stubGlobal('getComputedStyle', spy)
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    pumpFrame()
    const before = spy.mock.calls.length
    engine.invalidateColors()
    pumpFrame()
    expect(spy.mock.calls.length).toBeGreaterThan(before)
  })

  it('extends the cached path instead of rebuilding it each frame', () => {
    // The fade repaints every live stroke every frame, so rebuilding the path
    // would make per-frame cost O(total points) — issued twice per stroke, for
    // the halo and the colour. Measured at ~82% decode retention with three
    // people drawing before this was cached.
    const { engine, canvas } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.extendLocal([{ x: 200, y: 200 }, { x: 300, y: 300 }])
    pumpFrame()
    // Repainting without new points must not re-issue any path construction.
    const before = pathLineTos
    pumpFrame()
    pumpFrame()
    expect(pathLineTos).toBe(before)
    // ...but the strokes themselves keep being painted.
    expect(canvas.__ctx.stroke).toHaveBeenCalled()
  })

  it('rebuilds cached paths when the container resizes', () => {
    // Paths are cached in PIXEL space, so a resize must invalidate them or the
    // ink would stay anchored to the old geometry.
    const { engine } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    engine.extendLocal([{ x: 200, y: 200 }])
    pumpFrame()
    const before = pathLineTos
    engine.setGeometry(1200, 700, 16 / 9, 1)
    pumpFrame()
    expect(pathLineTos).toBeGreaterThan(before)
  })

  it('clears the canvas each frame before repainting', () => {
    const { engine, canvas } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    pumpFrame()
    expect(canvas.__ctx.clearRect).toHaveBeenCalled()
  })

  it('draws a dot for a tap with no drag', () => {
    const { engine, canvas } = makeEngine()
    engine.beginLocal({ x: 100, y: 100 }, 'Ada#1')
    pumpFrame()
    expect(canvas.__ctx.stroke).toHaveBeenCalled()
  })
})

describe('bounds on remote input', () => {
  const packet = (points: number[], strokeId = 7, seq = 0): StrokePacket => ({
    colorIdx: 2,
    strokeId,
    seq,
    target: 0,
    points: Float32Array.from(points),
  })

  it('caps how many strokes one sender can hold open at once', () => {
    // strokeId is a u16 off the wire, so an unbounded map would let one peer open
    // 65536 strokes — a few hundred KB of packets becoming hundreds of MB here.
    // Expiry doesn't cover it: a whole fade window's worth is live simultaneously.
    const { engine } = makeEngine()
    for (let id = 0; id < MAX_STROKES_PER_SENDER * 4; id++) {
      engine.ingest('Flood#9', packet([0.1, 0.1], id), 'Flood')
    }
    expect(engine.liveStrokes).toBe(MAX_STROKES_PER_SENDER)
  })

  it('budgets per sender, so a flooder cannot crowd out anyone else', () => {
    const { engine } = makeEngine()
    for (let id = 0; id < MAX_STROKES_PER_SENDER * 4; id++) {
      engine.ingest('Flood#9', packet([0.1, 0.1], id), 'Flood')
    }
    engine.ingest('Bo#2', packet([0.5, 0.5], 1), 'Bo')
    expect(engine.liveStrokes).toBe(MAX_STROKES_PER_SENDER + 1)
  })

  it('releases a sender budget as their strokes expire', () => {
    const { engine } = makeEngine()
    for (let id = 0; id < MAX_STROKES_PER_SENDER; id++) {
      engine.ingest('Flood#9', packet([0.1, 0.1], id), 'Flood')
    }
    clock += LIFETIME_MS + 1
    pumpFrame()
    expect(engine.liveStrokes).toBe(0)
    // The cap must not be sticky — a normal sender keeps working afterwards.
    engine.ingest('Flood#9', packet([0.2, 0.2], 999), 'Flood')
    expect(engine.liveStrokes).toBe(1)
  })

  it('caps the points in a single remote stroke', () => {
    const { engine } = makeEngine()
    // Packets overlap by one point, so each 2-point packet adds one.
    for (let i = 0; i < MAX_POINTS_PER_STROKE + 200; i++) {
      engine.ingest('Flood#9', packet([0.1, 0.1, 0.2, 0.2], 7, i), 'Flood')
    }
    pumpFrame()
    const drawn = pathLineTos
    expect(drawn).toBeLessThanOrEqual(MAX_POINTS_PER_STROKE)

    // Past the cap the stroke stops growing, so a repaint issues no new segments.
    for (let i = 0; i < 100; i++) engine.ingest('Flood#9', packet([0.3, 0.3], 7, 9000 + i), 'Flood')
    pumpFrame()
    expect(pathLineTos).toBe(drawn)
  })
})
