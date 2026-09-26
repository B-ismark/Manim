import { describe, it, expect } from 'vitest'
import { lookupError } from './lookupError'

describe('lookupError', () => {
  it('tells a throttled user to wait', () => {
    expect(lookupError({ message: 'rate_limited' })).toMatch(/try again in a few minutes/)
  })
  it('keeps the generic message otherwise', () => {
    expect(lookupError({ message: 'network' })).toBe('Couldn’t look up that person.')
  })
})
