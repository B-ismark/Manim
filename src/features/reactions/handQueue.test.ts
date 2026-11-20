import { describe, expect, it } from 'vitest'
import { HAND_AT_ATTR, HAND_ATTR, handQueue } from './useReactions'

const p = (identity: string, raised: boolean, at?: number) => ({
  identity,
  attributes: raised ? { [HAND_ATTR]: '1', ...(at ? { [HAND_AT_ATTR]: String(at) } : {}) } : {},
})

describe('handQueue', () => {
  it('orders raised hands by when they went up, ignoring lowered ones', () => {
    expect(handQueue([p('a', true, 300), p('b', false), p('c', true, 100), p('d', true, 200)])).toEqual(['c', 'd', 'a'])
  })

  it('puts hands with no time (older builds) after timed ones, by identity', () => {
    expect(handQueue([p('z', true), p('y', true), p('x', true, 50)])).toEqual(['x', 'y', 'z'])
  })

  it('breaks a tie the same way on every client', () => {
    expect(handQueue([p('b', true, 10), p('a', true, 10)])).toEqual(['a', 'b'])
  })
})
