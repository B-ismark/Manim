/**
 * People's search: does `name` match what was typed?
 *
 * Case- and accent-insensitive ("jose" finds "José", "AMA" finds "Ama"), and every
 * typed word has to appear somewhere in the name, in any order ("kofi a" finds
 * "Kofi Annan" and "Ama Kofi"). Pure so it's testable without the panel.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export function nameMatches(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = fold(name)
  return words.every((w) => hay.includes(w))
}

/** Search shows once the list is long enough to need it (Teams' threshold is similar). */
export const SEARCH_MIN = 8

/**
 * The threshold in effect. Tests pin `globalThis.__MN_PEOPLE_SEARCH_MIN` lower
 * (as the blur tests pin `__MN_BLUR_STALL_MS`), because putting eight browsers in
 * one call just to see a search box would cost a runner more than the test is worth.
 */
export function searchMin(): number {
  const pinned = (globalThis as { __MN_PEOPLE_SEARCH_MIN?: unknown }).__MN_PEOPLE_SEARCH_MIN
  return typeof pinned === 'number' && pinned >= 0 ? pinned : SEARCH_MIN
}
