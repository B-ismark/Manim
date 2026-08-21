/**
 * Page-sequence maths for the touch stage.
 *
 * On a phone the stage is ONE horizontal sequence, not a pair of modes:
 * page 0 is the focus view (the shared screen, or whoever is speaking) and pages
 * 1..n are gallery pages. Swiping moves along it. This is Zoom's model, and
 * adopting it removed the conflict that blocked gallery paging here — horizontal
 * swipe used to toggle grid/speaker, so the gesture every phone user reaches for
 * to turn a page was already taken. Now the swipe IS the switch: there is no mode
 * to leave, only a page to leave.
 *
 * Pure so the clamping and the off-page lookup are testable; the React side just
 * renders whichever page this returns. Clamping matters more than it looks — the
 * page index outlives the thing it points at (people leave, the viewport rotates,
 * a share ends), and an index past the end renders an empty stage.
 */

export type PageKind = 'focus' | 'gallery'

export interface StagePage {
  /** Total pages, always ≥ 1 — the focus page always exists. */
  count: number
  /** The requested index, clamped into range. */
  index: number
  kind: PageKind
  /** Gallery slice to mount for this page. Empty on the focus page. */
  start: number
  end: number
}

export interface PageInput {
  /** Tracks that tile in the gallery — everyone the focus page isn't showing. */
  galleryCount: number
  /** Tiles per gallery page (from gridCapacity). */
  perPage: number
  /** Requested page index, 0 = focus. */
  index: number
}

export function stagePage({ galleryCount, perPage, index }: PageInput): StagePage {
  const per = Math.max(1, Math.floor(perPage))
  const galleryPages = Math.max(0, Math.ceil(Math.max(0, galleryCount) / per))
  const count = 1 + galleryPages
  const i = Math.min(Math.max(0, Math.floor(index) || 0), count - 1)
  if (i === 0) return { count, index: 0, kind: 'focus', start: 0, end: 0 }
  const start = (i - 1) * per
  return { count, index: i, kind: 'gallery', start, end: Math.min(start + per, galleryCount) }
}

/**
 * Which page shows gallery item `item`? Used by the off-page-speaker jump, which
 * stops being a nicety once a room needs more than a couple of pages — with a
 * 2x2 phone page, a 28-person call is seven pages and nobody swipes seven times.
 * Returns -1 when there's no such item.
 */
export function pageOfGalleryItem(item: number, perPage: number): number {
  if (item < 0) return -1
  return 1 + Math.floor(item / Math.max(1, Math.floor(perPage)))
}

/**
 * Dots or a counter?
 *
 * A dot row stops communicating past about five — iOS page controls compress, and
 * the dots become decoration. Past the threshold the indicator becomes a
 * "2 / 7"-style pill, which stays readable at any room size.
 */
export const MAX_DOTS = 5
export function indicatorStyle(count: number): 'none' | 'dots' | 'counter' {
  if (count <= 1) return 'none'
  return count <= MAX_DOTS ? 'dots' : 'counter'
}
