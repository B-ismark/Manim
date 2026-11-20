import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/**
 * How many controls the DESKTOP bar has folded into More, decided by measuring
 * the bar rather than by a fixed breakpoint.
 *
 * It used to be one cliff: `(max-width: 679px)` took the bar from everything to
 * mic / camera / chat / More / Leave in a single step. The 680 was the widest
 * bar anyone had measured (a host mid-share, ~614px) plus margins — so a guest's
 * narrower bar folded with room to spare, and every control added meant
 * re-measuring and moving the number. Teams folds one control at a time instead,
 * lowest priority first, and that is what this does.
 *
 * Fold order (each level includes the ones before it):
 *   1 — Reactions (and raise hand) → More's reactions row
 *   2 — Annotate (only present mid-share)
 *   3 — Share screen
 *   4 — The device carets and the host's split Leave → the old narrow bar
 * Mic, camera, chat, More and Leave never fold. Labels are never added: the
 * island stays icon-only at every width (owner's call, November 2026).
 *
 * Touch never folds — its bar has its own fixed fit (lib/chromeBands,
 * `test:mobile-sm`).
 */
export const BAR_FOLD_MAX = 4

/** Fold levels named for the controls they take off the bar. */
export const FOLD = { reactions: 1, annotate: 2, share: 3, devices: 4 } as const

/**
 * One measuring step: fold one more control while the bar is wider than the
 * room it has. Pure, so the rule is testable without a browser.
 */
export function nextFoldLevel(level: number, barW: number, avail: number, max = BAR_FOLD_MAX): number {
  return barW > avail && level < max ? level + 1 : level
}

/** The island's wrapper is `inset-x-0 px-4`: 16px each side. */
const BAR_GUTTER = 32

/**
 * Measures the bar and returns its fold level. On a resize (or when `contentKey`
 * changes — a share starts and Annotate appears) it starts again from 0 and
 * folds upward inside layout effects, so every intermediate state is resolved
 * before the browser paints: no flash of an overflowing bar.
 */
export function useBarFold(ref: RefObject<HTMLElement | null>, enabled: boolean, contentKey: string): number {
  const [level, setLevel] = useState(0)
  // Bumped to force a re-measure when the level is already 0 (setLevel(0) would
  // be a no-op and the bar might now be too wide).
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setLevel(0)
        setEpoch((e) => e + 1)
      })
    }
    window.addEventListener('resize', onResize)
    // The bar can also grow mid-call with nothing in `contentKey` changing (a
    // status pill appears). Re-measure WITHOUT unfolding: it only ever folds
    // further, and once it fits a resize is a no-op, so this can't loop.
    const ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setEpoch((e) => e + 1))
    if (ro && ref.current) ro.observe(ref.current)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [enabled, ref])

  // Content changed: unfold and measure again.
  useLayoutEffect(() => {
    setLevel(0)
    setEpoch((e) => e + 1)
  }, [contentKey, enabled])

  useLayoutEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    // Border box; a translateX (the dock shift) doesn't change the width.
    const barW = el.getBoundingClientRect().width
    const next = nextFoldLevel(level, barW, window.innerWidth - BAR_GUTTER)
    if (next !== level) setLevel(next)
  }, [level, epoch, enabled, ref])

  return enabled ? level : 0
}
