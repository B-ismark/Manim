import { describe, it, expect } from 'vitest'
import { indicatorStyle, pageOfGalleryItem, stagePage, MAX_DOTS } from './stagePager'

describe('stagePage', () => {
  it('page 0 is always the focus view', () => {
    const p = stagePage({ galleryCount: 12, perPage: 4, index: 0 })
    expect(p).toEqual({ count: 4, index: 0, kind: 'focus', start: 0, end: 0 })
  })

  it('gallery pages follow the focus page', () => {
    expect(stagePage({ galleryCount: 9, perPage: 4, index: 1 })).toMatchObject({ kind: 'gallery', start: 0, end: 4 })
    expect(stagePage({ galleryCount: 9, perPage: 4, index: 2 })).toMatchObject({ kind: 'gallery', start: 4, end: 8 })
    expect(stagePage({ galleryCount: 9, perPage: 4, index: 3 })).toMatchObject({ kind: 'gallery', start: 8, end: 9 })
  })

  it('counts a 28-person room at 4 per page as 1 focus + 7 gallery', () => {
    expect(stagePage({ galleryCount: 28, perPage: 4, index: 0 }).count).toBe(8)
  })

  it('the focus page exists even with nobody to tile', () => {
    const p = stagePage({ galleryCount: 0, perPage: 4, index: 0 })
    expect(p.count).toBe(1)
    expect(p.kind).toBe('focus')
  })

  it('clamps an index that outlived its page — people left, phone rotated', () => {
    // Was on page 5; the room shrank to one gallery page.
    expect(stagePage({ galleryCount: 3, perPage: 4, index: 5 })).toMatchObject({ count: 2, index: 1 })
    // Everyone left.
    expect(stagePage({ galleryCount: 0, perPage: 4, index: 5 })).toMatchObject({ count: 1, index: 0, kind: 'focus' })
  })

  it('clamps a negative or junk index to the focus page', () => {
    expect(stagePage({ galleryCount: 9, perPage: 4, index: -3 }).index).toBe(0)
    expect(stagePage({ galleryCount: 9, perPage: 4, index: NaN }).index).toBe(0)
  })

  it('survives a degenerate perPage', () => {
    expect(stagePage({ galleryCount: 9, perPage: 0, index: 1 })).toMatchObject({ start: 0, end: 1 })
    expect(stagePage({ galleryCount: 9, perPage: -4, index: 1 })).toMatchObject({ start: 0, end: 1 })
  })

  it('never returns a slice past the end', () => {
    for (let n = 0; n <= 30; n++) {
      for (let i = 0; i <= 12; i++) {
        const p = stagePage({ galleryCount: n, perPage: 4, index: i })
        expect(p.end).toBeLessThanOrEqual(n)
        expect(p.start).toBeLessThanOrEqual(p.end)
        expect(p.index).toBeLessThan(p.count)
      }
    }
  })

  it('covers every gallery item exactly once across its pages', () => {
    const n = 23, perPage = 4
    const seen: number[] = []
    const { count } = stagePage({ galleryCount: n, perPage, index: 0 })
    for (let i = 1; i < count; i++) {
      const p = stagePage({ galleryCount: n, perPage, index: i })
      for (let k = p.start; k < p.end; k++) seen.push(k)
    }
    expect(seen).toEqual([...Array(n).keys()])
  })
})

describe('pageOfGalleryItem', () => {
  it('maps a gallery index onto its page, offset past the focus page', () => {
    expect(pageOfGalleryItem(0, 4)).toBe(1)
    expect(pageOfGalleryItem(3, 4)).toBe(1)
    expect(pageOfGalleryItem(4, 4)).toBe(2)
    expect(pageOfGalleryItem(27, 4)).toBe(7)
  })
  it('is -1 when there is no such item', () => {
    expect(pageOfGalleryItem(-1, 4)).toBe(-1)
  })
})

describe('indicatorStyle', () => {
  it('shows nothing when there is only the focus page', () => {
    expect(indicatorStyle(1)).toBe('none')
  })
  it('shows dots up to the readable limit', () => {
    expect(indicatorStyle(2)).toBe('dots')
    expect(indicatorStyle(MAX_DOTS)).toBe('dots')
  })
  it('switches to a counter once dots stop communicating', () => {
    expect(indicatorStyle(MAX_DOTS + 1)).toBe('counter')
    expect(indicatorStyle(8)).toBe('counter')
  })
})
