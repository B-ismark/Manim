/**
 * Ramer–Douglas–Peucker polyline simplification.
 *
 * `getCoalescedEvents()` deliberately hands us EVERY pointer sample the device
 * produced — 200+/sec on a high-refresh mouse or pen — because dense samples make
 * a smooth local curve. Putting all of them on the wire would be wasteful: most
 * are visually redundant, and packets are capped near the MTU. So we render
 * locally from the dense path and transmit a simplified one.
 *
 * Points are flat [x0,y0,x1,y1,…] pairs in unit space (0..1), matching what the
 * engine stores and what wire.ts encodes. Pure — no canvas, no LiveKit.
 */

/** Squared perpendicular distance from (px,py) to the segment (ax,ay)→(bx,by). */
function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = 0
  if (lenSq > 0) {
    // Project onto the segment, clamped to its ends so a point beyond an
    // endpoint measures to that endpoint rather than to the infinite line.
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = t < 0 ? 0 : t > 1 ? 1 : t
  }
  const cx = ax + t * dx
  const cy = ay + t * dy
  const ex = px - cx
  const ey = py - cy
  return ex * ex + ey * ey
}

/**
 * Simplify a flat point array, keeping every point further than `epsilon` from
 * the simplified path. Both endpoints are always preserved — dropping them would
 * visibly shorten the stroke.
 *
 * Iterative (explicit stack) rather than recursive: a dense stroke can be
 * thousands of points and the naive recursion is O(n) deep in the degenerate
 * case, which is a stack overflow on a long slow drag.
 */
export function simplify(points: Float32Array, epsilon: number): Float32Array {
  const n = points.length >> 1
  if (n <= 2 || !(epsilon > 0)) return points

  const epsSq = epsilon * epsilon
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1

  const stack: number[] = [0, n - 1]
  while (stack.length > 0) {
    const end = stack.pop() as number
    const start = stack.pop() as number
    if (end - start < 2) continue

    const ax = points[start * 2]
    const ay = points[start * 2 + 1]
    const bx = points[end * 2]
    const by = points[end * 2 + 1]

    let worst = -1
    let worstDist = 0
    for (let i = start + 1; i < end; i++) {
      const d = segDistSq(points[i * 2], points[i * 2 + 1], ax, ay, bx, by)
      if (d > worstDist) {
        worstDist = d
        worst = i
      }
    }

    if (worst !== -1 && worstDist > epsSq) {
      keep[worst] = 1
      stack.push(start, worst, worst, end)
    }
  }

  let kept = 0
  for (let i = 0; i < n; i++) kept += keep[i]
  const out = new Float32Array(kept * 2)
  let w = 0
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue
    out[w++] = points[i * 2]
    out[w++] = points[i * 2 + 1]
  }
  return out
}
