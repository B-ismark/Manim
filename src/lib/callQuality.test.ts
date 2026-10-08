import { describe, it, expect } from 'vitest'
import { edgeRegion, fpsRange, lossRange, median, rttRange, summarise, type QualitySample } from './callQuality'

const s = (o: Partial<QualitySample>): QualitySample => ({ received: 0, lost: 0, ...o })

describe('ranges', () => {
  it('bucket at their boundaries', () => {
    expect([99, 100, 199, 200, 300].map(rttRange)).toEqual(['lt100', '100-200', '100-200', '200-300', '300plus'])
    expect([0.5, 1, 2.9, 3, 10].map(lossRange)).toEqual(['lt1', '1-3', '1-3', '3-10', '10plus'])
    expect([5, 10, 19.9, 20, 30].map(fpsRange)).toEqual(['lt10', '10-20', '10-20', '20plus', '20plus'])
  })

  it('median handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeUndefined()
  })
})

describe('edgeRegion', () => {
  it('maps edge names to a continent and never passes the raw name on', () => {
    expect(edgeRegion('Marseille')).toBe('eu')
    expect(edgeRegion('eu-central')).toBe('eu')
    expect(edgeRegion('South Africa')).toBe('af')
    expect(edgeRegion('us-east')).toBe('na')
    expect(edgeRegion('Brazil')).toBe('sa')
    expect(edgeRegion('India')).toBe('as')
    expect(edgeRegion('Sydney')).toBe('oc')
    expect(edgeRegion('')).toBe('other')
    expect(edgeRegion(undefined)).toBe('other')
    expect(edgeRegion('somewhere-new')).toBe('other')
  })
})

describe('summarise', () => {
  it('says nothing about a call too short to mean anything', () => {
    expect(summarise([s({}), s({})])).toBeNull()
  })

  it('summarises a call by medians and total loss', () => {
    const q = summarise([
      s({ rttMs: 140, received: 1000, lost: 10, recvFps: 24, limit: 'none' }),
      s({ rttMs: 160, received: 1000, lost: 30, recvFps: 12, limit: 'cpu' }),
      s({ rttMs: 900, received: 1000, lost: 20, recvFps: 8, limit: 'cpu' }),
    ])
    expect(q).toEqual({ rtt: '100-200', loss: '1-3', fps: '10-20', limit: 'cpu' })
  })

  it('leaves out what was never measured (no camera, no remote video)', () => {
    expect(summarise([s({ rttMs: 50 }), s({ rttMs: 50 }), s({ rttMs: 50 })])).toEqual({ rtt: 'lt100' })
  })

  it('a tie between limits reports the worse one', () => {
    const q = summarise([s({ limit: 'none' }), s({ limit: 'cpu' }), s({})])
    expect(q?.limit).toBe('cpu')
  })
})
