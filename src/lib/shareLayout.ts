/**
 * Stage geometry for the two layouts that put ONE tile in charge and everyone else
 * in a filmstrip: speaker view (a person is big) and content view (a screen share
 * is big). Pure functions — no React, no LiveKit — so the maths is unit-testable
 * and Stage just renders the boxes it's handed.
 *
 * This is the Teams model, and it replaced an adaptive split that sized the big
 * region to the CONTENT's aspect and clamped it to [0.5, 0.85] of the stage. That
 * split had two failure modes we kept re-discovering:
 *
 *  - A 16:9 share on a 16:9 stage wants ~100% of it, got clamped to 85%, and the
 *    15% "grid" it left behind was a band of tiles too short to read — so the share
 *    was letterboxed to make room for a strip that didn't work either.
 *  - A camera-off speaker got the same treatment in reverse: a 1500x900 stage
 *    handed to a single avatar, with the two people who WERE on camera parked in a
 *    112px strip at the bottom, half of it underneath the floating control island.
 *
 * A filmstrip of FIXED thickness fixes both. The strip is sized to be legible on
 * its own terms (a 16:9 thumbnail you can recognise a face in), the big region gets
 * everything else, and neither is negotiating with the other's aspect ratio. Which
 * is what Teams, Meet and Zoom all do, and why their share view doesn't wobble when
 * a presenter switches from a spreadsheet to a browser window.
 *
 * Side is viewport-driven: a wide stage puts the strip on the RIGHT of a share (the
 * share is width-hungry, the stage has width to spare vertically) and along the TOP
 * of a speaker; a portrait stage puts it along the bottom.
 */

export type StripSide = 'top' | 'right' | 'bottom'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StripLayout {
  /** Where the filmstrip sits. `capacity === 0` means there is no strip at all. */
  side: StripSide
  /** The big tile's box (share or focused person). */
  big: Rect
  /** The filmstrip's box — zero-sized when there's no strip. */
  strip: Rect
  /** One thumbnail's box inside the strip. */
  tile: { w: number; h: number }
  /** How many thumbnails fit. 0 = no strip (nobody to show, or no room). */
  capacity: number
}

/** Filmstrip thumbnails are 16:9 — a face at thumbnail scale, not a portrait sliver. */
const TILE_ASPECT = 16 / 9

/**
 * Strip thickness, in px, as a fraction of the stage with hard bounds.
 *
 * The bounds are the whole point: a fraction alone gives a 200px strip on a 4K
 * monitor (thumbnails the size of the speaker) and a 60px one on a laptop (faces
 * you can't identify). ~90px is the floor where a 16:9 thumbnail still reads as a
 * person; ~132 is where it stops feeling like a strip.
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Below this, the big region has been eaten by the strip — drop the strip instead. */
const MIN_BIG_W = 360
const MIN_BIG_H = 220

/**
 * Speaker view: one large feed with a filmstrip along the TOP.
 *
 * Top, not bottom, and this is the one geometric decision in the file that isn't
 * about aspect ratios. The control island floats over the bottom of the stage, so
 * anything parked there is negotiating with it forever — the strip used to sit in
 * `pb-[5.5rem]` and still ended up with more than half its height underneath the
 * bar, because the reserved band and the strip's own height were picked
 * independently and nothing checked they added up. A strip along the top cannot
 * collide with a bar along the bottom, at any viewport, with no arithmetic.
 */
export function speakerLayout(width: number, height: number, count: number, gap = 12): StripLayout {
  const empty = { x: 0, y: 0, w: 0, h: 0 }
  const none: StripLayout = {
    side: 'top',
    big: { x: 0, y: 0, w: width, h: height },
    strip: empty,
    tile: { w: 0, h: 0 },
    capacity: 0,
  }
  if (count <= 0 || width <= 0 || height <= 0) return none

  const stripH = clamp(height * 0.16, 88, 132)
  const bigH = height - stripH - gap
  const tileW = stripH * TILE_ASPECT
  const capacity = Math.floor((width + gap) / (tileW + gap))
  // No room for the strip, or not even one legible thumbnail in it → the big tile
  // takes the stage and the caller falls back to the People panel for the roster.
  if (bigH < MIN_BIG_H || capacity < 1) return none

  return {
    side: 'top',
    big: { x: 0, y: stripH + gap, w: width, h: bigH },
    strip: { x: 0, y: 0, w: width, h: stripH },
    tile: { w: tileW, h: stripH },
    capacity,
  }
}

/**
 * Content view: a shared screen fills the stage, people ride in a filmstrip beside
 * it — on the RIGHT when the stage is landscape, along the BOTTOM when it's
 * portrait.
 *
 * Right-hand rail for a landscape stage because a screen share is itself landscape:
 * it is HEIGHT-bound on a 16:9 stage, so the width a rail takes costs the share far
 * less than the height a bottom strip would. On a portrait stage the reverse holds
 * (the share is width-bound and the slack is vertical), which is the same
 * observation `rosterFits` makes on a phone.
 */
export function contentLayout(
  width: number,
  height: number,
  count: number,
  gap = 12,
  /**
   * Dead space at the TOP of a right-hand rail, for the top-right stage chrome
   * (the participants chip) that shares that corner. Taken off the rail only —
   * the share keeps its full height, which is the whole reason the rail is on the
   * right — and taken off before capacity is computed, so the count reflects the
   * space the tiles actually get rather than the space the region nominally has.
   * Irrelevant to a bottom strip, which nothing overlays.
   */
  railTopInset = 0,
): StripLayout {
  const empty = { x: 0, y: 0, w: 0, h: 0 }
  const none: StripLayout = {
    side: 'right',
    big: { x: 0, y: 0, w: width, h: height },
    strip: empty,
    tile: { w: 0, h: 0 },
    capacity: 0,
  }
  if (count <= 0 || width <= 0 || height <= 0) return none

  if (width >= height) {
    const railW = clamp(width * 0.17, 168, 232)
    const bigW = width - railW - gap
    const tileH = railW / TILE_ASPECT
    const railTop = Math.max(0, Math.min(railTopInset, height))
    const railH = height - railTop
    const capacity = Math.floor((railH + gap) / (tileH + gap))
    // A narrow window (or a docked side panel) can leave too little for both. The
    // share is the thing being presented — it keeps the space, and the strip flips
    // to the bottom where it costs less, rather than squeezing the content to a
    // sliver.
    if (bigW >= MIN_BIG_W && capacity >= 1) {
      return {
        side: 'right',
        big: { x: 0, y: 0, w: bigW, h: height },
        strip: { x: bigW + gap, y: railTop, w: railW, h: railH },
        tile: { w: railW, h: tileH },
        capacity,
      }
    }
  }

  const stripH = clamp(height * 0.16, 84, 120)
  const bigH = height - stripH - gap
  const tileW = stripH * TILE_ASPECT
  const capacity = Math.floor((width + gap) / (tileW + gap))
  if (bigH < MIN_BIG_H || capacity < 1) return { ...none, side: 'bottom' }

  return {
    side: 'bottom',
    big: { x: 0, y: 0, w: width, h: bigH },
    strip: { x: 0, y: bigH + gap, w: width, h: stripH },
    tile: { w: tileW, h: stripH },
    capacity,
  }
}

/**
 * Order strip/grid tiles: VIDEO-ON first (you want faces during a share — Teams'
 * "Prioritize video"), camera-off avatars to the back (first to fall into the
 * overflow). `hasVideo` is a STABLE signal so tiles don't jitter; speaking is
 * deliberately NOT a sort key (it would reshuffle mid-sentence) — Stage surfaces
 * speakers with a ring instead. `key` breaks ties stably.
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
