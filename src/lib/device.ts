/*
  Coarse device-capability checks for perf/UX decisions (mobile layout, blur cost).
  Feature/capability based — no brittle UA sniffing.
*/

/** Touch-primary, phone-sized viewport — drives portrait-intentional mobile UI. */
export function isMobile(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(max-width: 768px)').matches
  )
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
