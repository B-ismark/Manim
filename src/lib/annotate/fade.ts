/**
 * Stroke lifetime. Annotation here is a POINTING GESTURE, not a markup layer
 * (the Slack huddle model): a stroke starts fading shortly after it's drawn and
 * is gone a few seconds later.
 *
 * This is what keeps the feature cheap. Because nothing outlives its TTL there
 * is no persistent stroke set — so no late-joiner state sync, no eviction policy,
 * no clear-all moderation, and no committed canvas layer to replay on resize.
 * The render loop also gets a natural stop condition: when the last stroke
 * expires there is nothing to draw, so the rAF loop parks itself instead of
 * competing with the video decoder for frames.
 *
 * Pure functions — no canvas, no timers — so the timing curve is unit-testable.
 */

/** How long a stroke stays fully opaque after its last point, in ms. */
export const HOLD_MS = 2200

/** How long the fade-out itself takes, in ms. */
export const FADE_MS = 1800

/** Total lifetime of a stroke measured from its last point. */
export const LIFETIME_MS = HOLD_MS + FADE_MS

/**
 * Opacity multiplier for a stroke whose most recent point landed `age` ms ago.
 *
 * Held solid through HOLD_MS so a quick gesture is unmistakably visible, then
 * eased to zero. The curve is smoothstep rather than linear: a linear ramp reads
 * as an abrupt "switch off" at the tail because perceived brightness isn't
 * linear in alpha. Returns 0 once expired.
 *
 * Age is measured from the stroke's LAST point, not its first, so a long
 * continuous stroke doesn't start dissolving at the head while you're still
 * drawing the tail.
 */
export function opacityForAge(age: number): number {
  if (!(age > 0)) return 1
  if (age <= HOLD_MS) return 1
  const t = (age - HOLD_MS) / FADE_MS
  if (t >= 1) return 0
  // smoothstep(1 → 0)
  const inv = 1 - t
  return inv * inv * (3 - 2 * inv)
}

/** Has a stroke whose last point landed `age` ms ago fully expired? */
export const isExpired = (age: number): boolean => age >= LIFETIME_MS

/**
 * Tail dissolve: what fraction of a stroke, from its START, has been eaten by
 * age `age`. 0 through HOLD_MS, then it runs to 1 over FADE_MS — the same
 * lifetime as the opacity fade, so expiry, the parked loop and every test of the
 * TTL are unchanged. Ease-in, so the trail starts slowly and finishes briskly,
 * the way a laser pointer's afterglow does.
 */
export function tailTrimForAge(age: number): number {
  if (!(age > HOLD_MS)) return 0
  const t = (age - HOLD_MS) / FADE_MS
  if (t >= 1) return 1
  return t * t * (3 - 2 * t) // smoothstep 0 → 1
}

/**
 * Opacity of what's left of a dissolving stroke. Solid until the last fifth of
 * the trail, then it fades as it goes, so the final few pixels don't blink out.
 */
export function dissolveOpacity(trim: number): number {
  if (trim >= 1) return 0
  return Math.min(1, (1 - trim) / 0.2)
}

/**
 * A name chip follows the pen while its author is drawing and goes a beat after
 * they stop. A remote viewer can't see pen-up (the wire has no end-of-stroke
 * marker), so "drawing" means "a point landed within CHIP_HOLD_MS"; then the chip
 * fades over CHIP_FADE_MS — about a second after the pen lifts, long before the
 * ink itself goes.
 */
export const CHIP_HOLD_MS = 300
export const CHIP_FADE_MS = 700
export function chipOpacity(age: number): number {
  if (!(age > CHIP_HOLD_MS)) return 1
  const t = (age - CHIP_HOLD_MS) / CHIP_FADE_MS
  if (t >= 1) return 0
  const inv = 1 - t
  return inv * inv * (3 - 2 * inv)
}
