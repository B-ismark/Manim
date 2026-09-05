import { describe, it, expect } from 'vitest'
import { prettyRoom, toSlug } from './roomName'

describe('prettyRoom', () => {
  it('turns a hyphenated slug into Title Case display', () => {
    expect(prettyRoom('world-cup')).toBe('World Cup')
  })

  it('handles underscores too', () => {
    expect(prettyRoom('team_standup')).toBe('Team Standup')
  })

  it('leaves numeric segments of generated codes intact', () => {
    expect(prettyRoom('calm-otter-417')).toBe('Calm Otter 417')
  })

  it('collapses repeated separators', () => {
    expect(prettyRoom('a--b__c')).toBe('A B C')
  })

  it('is stable on an already-pretty single word', () => {
    expect(prettyRoom('manim')).toBe('Manim')
  })

  it('does not throw on an empty string', () => {
    expect(prettyRoom('')).toBe('')
  })
})

describe('toSlug', () => {
  it('lowercases and hyphenates a typed name', () => {
    expect(toSlug('  World Cup  ')).toBe('world-cup')
  })

  it('strips characters that would corrupt the URL or its #fragment', () => {
    // `#` and `%` are the dangerous ones: invite secrets ride in the fragment.
    expect(toSlug('team/standup?x=1#k=abc')).toBe('teamstandupx1kabc')
    expect(toSlug('100% done')).toBe('100-done')
  })

  it('keeps letters and digits in NON-Latin scripts', () => {
    // An ASCII-only class erased these to '', making the rooms uncreatable.
    expect(toSlug('会议')).toBe('会议')
    expect(toSlug('Привет мир')).toBe('привет-мир')
    expect(toSlug('café')).toBe('café')
    expect(toSlug('한국어')).toBe('한국어')
    expect(toSlug('العربية')).toBe('العربية')
  })

  it('keeps combining marks, which carry the vowels in many scripts', () => {
    // \p{M}, not \p{L}: a letter-only class shreds these into a different word.
    expect(toSlug('हिन्दी')).toBe('हिन्दी')
    expect(toSlug('ไทย')).toBe('ไทย')
  })

  it('slugs a composed and a decomposed name to the SAME room', () => {
    // macOS and several IMEs hand over the decomposed form. Without NFC the two
    // spellings of one visible name route to two different rooms.
    const composed = 'café' // é as a single code point
    const decomposed = 'café' // e + combining acute
    expect(composed).not.toBe(decomposed)
    expect(toSlug(decomposed)).toBe(toSlug(composed))
    expect(toSlug(decomposed)).toBe('café')
  })

  it('keeps underscores, which need no URL encoding', () => {
    expect(toSlug('my_room')).toBe('my_room')
  })

  it('collapses repeated dashes and trims leading/trailing ones', () => {
    expect(toSlug('--a  --  b--')).toBe('a-b')
  })

  it('returns empty for a name with no letters or digits', () => {
    // The caller relies on this to warn instead of routing somewhere arbitrary.
    expect(toSlug('???')).toBe('')
    expect(toSlug('   ')).toBe('')
  })

  it('leaves an already-generated room code untouched', () => {
    expect(toSlug('calm-otter-hj3kq9mnp2rst')).toBe('calm-otter-hj3kq9mnp2rst')
  })

  it('round-trips through prettyRoom for a typed name', () => {
    expect(prettyRoom(toSlug('World Cup'))).toBe('World Cup')
  })
})
