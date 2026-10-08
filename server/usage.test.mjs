import { describe, it, expect } from 'vitest'
import { count, usageEvent } from './usage.mjs'

describe('usage counts', () => {
  it('keeps only listed events and values', () => {
    expect(usageEvent('joined', 'cam_on', 'low_off')).toEqual({ event: 'joined', a: 'cam_on', b: 'low_off' })
    expect(usageEvent('landing')).toEqual({ event: 'landing', a: '', b: '' })
    expect(usageEvent('joined', 'my-room-name')).toBeNull()
    expect(usageEvent('knock_rejected', 'locked', 'extra')).toBeNull()
    expect(usageEvent('rating', 'good', 'phone')).toEqual({ event: 'rating', a: 'good', b: 'phone' })
    expect(usageEvent('rating', 'meh')).toBeNull()
    expect(usageEvent('rating_issue', 'the audio kept cutting out')).toBeNull()
    expect(usageEvent('toString')).toBeNull()
    expect(usageEvent('nope')).toBeNull()
  })
  it('call-quality summaries take ranges and the edge continent, nothing finer', () => {
    expect(usageEvent('call_rtt', '100-200', 'eu')).toEqual({ event: 'call_rtt', a: '100-200', b: 'eu' })
    expect(usageEvent('call_loss', '1-3', 'af')).not.toBeNull()
    expect(usageEvent('call_fps', '10-20', 'phone')).not.toBeNull()
    expect(usageEvent('call_limit', 'cpu', 'desktop')).not.toBeNull()
    expect(usageEvent('call_rtt', '143', 'eu')).toBeNull()
    expect(usageEvent('call_rtt', 'lt100', 'Germany 2')).toBeNull()
    expect(usageEvent('call_limit', 'cpu', 'eu')).toBeNull()
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
