/*
  Coarse device-capability checks for perf/UX decisions (mobile layout, blur cost).
  Feature/capability based — no brittle UA sniffing.
*/

/**
 * Touch-primary, phone-sized viewport — used for PERF choices (capture
 * resolution, blur quality) where the small screen is the relevant signal.
 * For touch-UX behaviours (auto-hide chrome, gestures, portrait tiles, compact
 * control bar) use isTouch() instead, so wide foldables/tablets are covered.
 */
export function isMobile(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(max-width: 768px)').matches
  )
}

/** Touch-primary device (any size) — the signal for touch-UX layout/gestures. */
export function isTouch(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

/** Likely to struggle with per-frame ML (segmentation/blur). Conservative. */
export function isLowPowerDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  if (typeof mem === 'number' && mem <= 4) return true
  if (typeof cores === 'number' && cores <= 4) return true
  return isMobile()
}
