import { useEffect, useState } from 'react'

/**
 * Reactive (pointer: coarse) check — the single touch-UX signal across the app
 * (sheet vs popover, compact control bar, portrait tiles, auto-hide chrome).
 * Reacts to input changes, unlike the one-shot isTouch() capability check.
 * Keyed off pointer type, not width, so wide foldables/tablets are covered.
 */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return touch
}
