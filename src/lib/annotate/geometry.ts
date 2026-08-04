/**
 * Coordinate math for screen-share annotation. Pure functions — no React, no
 * LiveKit, no canvas — so the riskiest logic in the feature is unit-testable
 * while the LiveKit gates are frozen (same precedent as shareLayout.ts).
 *
 * THE PROBLEM THIS SOLVES
 * Everyone sees the shared screen at a different size, and the share renders
 * `object-contain` inside its region — so it is letterboxed (bars top/bottom) or
 * pillarboxed (bars left/right) whenever the region's aspect differs from the
 * video's. A stroke recorded as a raw pixel offset would land somewhere else on
 * every other participant's screen.
 *
 * So strokes travel in UNIT coordinates (0..1) measured against the video's own
 * content box, not the container. Sender normalizes with `toUnit`, receiver
 * denormalizes with `fromUnit` against ITS content box, and both land on the same
 * content pixel at any viewport size.
 */

import type { Rect } from '@/lib/shareLayout'

export interface Point {
  x: number
  y: number
}

/**
 * The box the video actually paints inside a `boxW × boxH` container under
 * `object-fit: contain`, given the video's intrinsic aspect (w/h).
 *
 * Wider-than-box content fills the width and letterboxes vertically; taller
 * content fills the height and pillarboxes horizontally. Returns a zero rect for
 * a degenerate box or aspect so callers can bail rather than divide by zero
 * (the container measures 0×0 for a frame before ResizeObserver reports).
 */
export function contentRect(boxW: number, boxH: number, aspect: number): Rect {
  if (!(boxW > 0) || !(boxH > 0) || !(aspect > 0) || !Number.isFinite(aspect)) {
    return { x: 0, y: 0, w: 0, h: 0 }
  }
  if (aspect > boxW / boxH) {
    // Content is proportionally wider than the box → full width, bars top/bottom.
    const h = boxW / aspect
    return { x: 0, y: (boxH - h) / 2, w: boxW, h }
  }
  // Content is proportionally taller (or equal) → full height, bars left/right.
  const w = boxH * aspect
  return { x: (boxW - w) / 2, y: 0, w, h: boxH }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Container-relative pixel → unit coordinate within the content box.
 *
 * Clamped to 0..1: a pointer in the letterbox bars is outside the shared content
 * and has no meaningful position on anyone else's screen, so it pins to the
 * nearest edge rather than producing an off-canvas stroke.
 */
export function toUnit(p: Point, content: Rect): Point {
  if (!(content.w > 0) || !(content.h > 0)) return { x: 0, y: 0 }
  return {
    x: clamp01((p.x - content.x) / content.w),
    y: clamp01((p.y - content.y) / content.h),
  }
}

/** Unit coordinate → container-relative pixel. Inverse of `toUnit`. */
export function fromUnit(u: Point, content: Rect): Point {
  return { x: content.x + u.x * content.w, y: content.y + u.y * content.h }
}

/** Is this container-relative point inside the painted video (not the bars)? */
export function insideContent(p: Point, content: Rect): boolean {
  return (
    content.w > 0 &&
    content.h > 0 &&
    p.x >= content.x &&
    p.x <= content.x + content.w &&
    p.y >= content.y &&
    p.y <= content.y + content.h
  )
}
