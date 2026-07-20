/**
 * Presentation-layout geometry for the screen-share view ("big content + segmented
 * grid", the Meet/Teams model). Pure functions — no React, no LiveKit — so the split
 * math is unit-testable and reused by Stage's PresentationStage.
 *
 * Decisions (see the design conversation):
 *  - ADAPTIVE big-region size: sized to the content's natural aspect so a portrait/small
 *    share on a wide desktop doesn't sit in black bars, and a short landscape share on a
 *    phone doesn't force a tall empty region. Clamped [MIN_FRACTION, MAX_FRACTION].
 *  - Split orientation is VIEWPORT-driven, not publisher-driven: wide stage -> big left
 *    (horizontal); portrait stage -> big top (vertical). Fixes the mobile letterbox.
 *  - The 1/3 grid does NOT show everyone: it fits a legible count (video-on prioritized)
 *    and the last slot becomes a "+N view all" overflow.
 *  - Any tile (the share OR a person) can occupy the big slot — Stage tracks which via a
 *    spotlight key; this module only computes boxes.
 */

export type Split = 'horizontal' | 'vertical'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PresentationLayout {
  split: Split
  /** Fraction of the stage the big region occupies along the split axis. */
  bigFraction: number
  big: Rect
  grid: Rect
}

/** Reserve at least 15% for the user grid; never let the big region become a sliver. */
export const MIN_FRACTION = 0.5
export const MAX_FRACTION = 0.85

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Wide/near-square stage -> horizontal (big left). Portrait -> vertical (big top).
 *  Keyed off the MEASURED stage box, so a docked side panel that narrows the stage can
 *  legitimately flip a laptop into the vertical split — correct, not a bug. */
export function pickSplit(width: number, height: number): Split {
  return width >= height ? 'horizontal' : 'vertical'
}

/**
 * Adaptive fraction of the stage the big region gets. Sized to the content's natural
 * dimension (at full stage height for a horizontal split, full width for vertical) so
 * the region hugs the content instead of wrapping it in black bars, then clamped so the
 * big tile stays prominent (never below MIN) and the user grid never vanishes (never
 * above MAX). Returns 1 when there are no user tiles (the big tile fills the stage).
 */
export function bigFraction(
  stageW: number,
  stageH: number,
  gridCount: number,
  split: Split,
  bigAspect = 16 / 9,
): number {
  if (gridCount <= 0) return 1
  const natural = split === 'horizontal' ? (stageH * bigAspect) / stageW : stageW / bigAspect / stageH
  return clamp(natural, MIN_FRACTION, MAX_FRACTION)
}

/**
 * Split the stage into the big region and the grid region. `gridCount` is how many tiles
 * will tile in the grid (everyone except whoever's in the big slot); `bigAspect` is the
 * w/h of the big tile's content (share or promoted cam). `gap` separates the two regions.
 */
export function presentationLayout(
  width: number,
  height: number,
  gridCount: number,
  bigAspect = 16 / 9,
  gap = 12,
): PresentationLayout {
  const split = pickSplit(width, height)
  const frac = bigFraction(width, height, gridCount, split, bigAspect)

  if (gridCount <= 0) {
    return { split, bigFraction: 1, big: { x: 0, y: 0, w: width, h: height }, grid: { x: 0, y: 0, w: 0, h: 0 } }
  }

  if (split === 'horizontal') {
    const bigW = Math.round((width - gap) * frac)
    const gridW = width - gap - bigW
    return {
      split,
      bigFraction: frac,
      big: { x: 0, y: 0, w: bigW, h: height },
      grid: { x: bigW + gap, y: 0, w: gridW, h: height },
    }
  }

  const bigH = Math.round((height - gap) * frac)
  const gridH = height - gap - bigH
  return {
    split,
    bigFraction: frac,
    big: { x: 0, y: 0, w: width, h: bigH },
    grid: { x: 0, y: bigH + gap, w: width, h: gridH },
  }
}

/** How many tiles legibly fit in the grid region — we do NOT try to show everyone.
 *  Fit at a minimum legible tile size (coarse = touch, smaller), so a 20-person room
 *  shows a handful + a "+N" overflow rather than a strip of dots. */
export function userRegionCapacity(width: number, height: number, coarse: boolean, gap = 6): number {
  const minW = coarse ? 96 : 128
  const minH = coarse ? 72 : 96
  const cols = Math.max(1, Math.floor((width + gap) / (minW + gap)))
  const rows = Math.max(1, Math.floor((height + gap) / (minH + gap)))
  return Math.max(1, cols * rows)
}

/**
 * Order grid tiles: VIDEO-ON first (you want faces during a share — Teams' "Prioritize
 * video"), camera-off avatars to the back (first to fall into the overflow). `hasVideo`
 * is a STABLE signal so tiles don't jitter; speaking is deliberately NOT a sort key (it
 * would reshuffle mid-sentence) — Stage surfaces speakers with a ring and by pulling an
 * off-screen speaker into the last visible slot. `key` breaks ties stably.
 */
export function orderUsers<T>(users: T[], hasVideo: (u: T) => boolean, key: (u: T) => string): T[] {
  const band = (u: T) => (hasVideo(u) ? 0 : 1)
  return [...users].sort((a, b) => band(a) - band(b) || key(a).localeCompare(key(b)))
}

/** Split ordered tiles into what's shown vs the overflow count. If everyone fits, no
 *  overflow. Otherwise reserve the last visible slot for the "+N view all" tile. */
export function splitVisible<T>(ordered: T[], capacity: number): { shown: T[]; overflow: number } {
  if (ordered.length <= capacity) return { shown: ordered, overflow: 0 }
  const shown = ordered.slice(0, Math.max(0, capacity - 1))
  return { shown, overflow: ordered.length - shown.length }
}
