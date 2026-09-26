import { describe, it, expect } from 'vitest'
import { count, usageEvent } from './usage.mjs'

describe('usage counts', () => {
  it('keeps only listed events and values', () => {
    expect(usageEvent('joined', 'cam_on', 'low_off')).toEqual({ event: 'joined', a: 'cam_on', b: 'low_off' })
    expect(usageEvent('landing')).toEqual({ event: 'landing', a: '', b: '' })
    expect(usageEvent('joined', 'my-room-name')).toBeNull()
    expect(usageEvent('knock_rejected', 'locked', 'extra')).toBeNull()
    expect(usageEvent('toString')).toBeNull()
    expect(usageEvent('nope')).toBeNull()
  })
  it('writes one data point, and is a no-op without the binding', () => {
    const points = []
    const env = { USAGE: { writeDataPoint: (p) => points.push(p) } }
    expect(count(env, 'left', '5-15', 'phone')).toBe(true)
    expect(points).toEqual([{ indexes: ['left'], blobs: ['left', '5-15', 'phone'], doubles: [1] }])
    expect(count({}, 'left', '5-15')).toBe(false)
    expect(count(env, 'left', 'forever')).toBe(false)
    const throwing = { USAGE: { writeDataPoint: () => { throw new Error('x') } } }
    expect(count(throwing, 'landing')).toBe(false)
  })
})
