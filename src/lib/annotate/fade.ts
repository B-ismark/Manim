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
