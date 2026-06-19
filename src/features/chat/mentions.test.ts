import { describe, it, expect } from 'vitest'
import {
  encodeMentions,
  plainText,
  mentionedIdentities,
  mentionsIdentity,
  type MentionTarget,
} from './mentions'

const targets: MentionTarget[] = [
  { identity: 'id-jane', name: 'Jane' },
  { identity: 'id-janet', name: 'Janet' },
  { identity: 'id-jane-doe', name: 'Jane Doe' },
]

describe('encodeMentions', () => {
  it('round-trips an encoded mention back to readable @Name', () => {
    const enc = encodeMentions('hi @Jane', targets)
    expect(enc).not.toBe('hi @Jane') // actually encoded
    expect(plainText(enc)).toBe('hi @Jane')
    expect(mentionedIdentities(enc)).toEqual(['id-jane'])
    expect(mentionsIdentity(enc, 'id-jane')).toBe(true)
    expect(mentionsIdentity(enc, 'id-janet')).toBe(false)
  })

  it('prefers the longest matching name (@Jane Doe over @Jane)', () => {
    const enc = encodeMentions('ping @Jane Doe please', targets)
    expect(mentionedIdentities(enc)).toEqual(['id-jane-doe'])
    expect(plainText(enc)).toBe('ping @Jane Doe please')
  })

  it('does not fire inside a longer name (@Jane must not match @Janet)', () => {
    const enc = encodeMentions('yo @Janet', targets)
    expect(mentionedIdentities(enc)).toEqual(['id-janet'])
  })

  it('requires a left boundary — mid-word foo@Jane is not a mention', () => {
    const enc = encodeMentions('foo@Jane', targets)
    expect(enc).toBe('foo@Jane')
    expect(mentionedIdentities(enc)).toEqual([])
  })

  it('respects trailing punctuation as a boundary', () => {
    const enc = encodeMentions('thanks @Jane!', targets)
    expect(mentionedIdentities(enc)).toEqual(['id-jane'])
    expect(plainText(enc)).toBe('thanks @Jane!')
  })

  it('drops ambiguous names: duplicate display name is left as plain text', () => {
    const dup: MentionTarget[] = [
      { identity: 'id-a', name: 'Sam' },
      { identity: 'id-b', name: 'Sam' },
    ]
    const enc = encodeMentions('hey @Sam', dup)
    expect(enc).toBe('hey @Sam')
    expect(mentionedIdentities(enc)).toEqual([])
  })

  it('is a no-op when there is no @ or no targets', () => {
    expect(encodeMentions('plain text', targets)).toBe('plain text')
    expect(encodeMentions('hi @Jane', [])).toBe('hi @Jane')
  })

  it('encodes multiple distinct mentions in one message', () => {
    const enc = encodeMentions('@Jane and @Janet', targets)
    expect(mentionedIdentities(enc)).toEqual(['id-jane', 'id-janet'])
  })
})
