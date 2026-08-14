import { describe, expect, it } from 'vitest'
import {
  bottleneckOf,
  classify,
  DEGRADE_SAMPLES,
  initialSettler,
  RECOVER_SAMPLES,
  settle,
  type NetworkTier,
} from './classify'

describe('classify', () => {
  it('scores the measured unshaped control as good', () => {
    // §2b: sub-ms RTT, no loss, encoder unconstrained.
    expect(classify({ rttMs: 1, uplinkLossPct: 0, limitedBy: 'none', upKbps: 1507 })).toBe('good')
  })

  it('scores the measured 2g-congested profile as dire', () => {
    // §2b: ~900ms RTT, 12% loss, encoder bandwidth-limited.
    expect(classify({ rttMs: 900, uplinkLossPct: 12, limitedBy: 'bandwidth' })).toBe('dire')
  })

  it('does NOT call a camera-off call bad just because throughput is low', () => {
    // The whole reason the tier ignores bitrate: audio-only on a clean link is
    // ~73 kbps, which any throughput threshold would misread as a failing network.
    expect(classify({ rttMs: 20, uplinkLossPct: 0, limitedBy: 'none', upKbps: 73 })).toBe('good')
  })

  it('treats a bandwidth-limited encoder as weak even when rtt and loss look fine', () => {
    expect(classify({ rttMs: 40, uplinkLossPct: 0, limitedBy: 'bandwidth' })).toBe('weak')
  })

  it('does not treat a cpu-limited encoder as a network problem', () => {
    expect(classify({ rttMs: 40, uplinkLossPct: 0, limitedBy: 'cpu' })).toBe('good')
  })

  it('takes the worse of the two directions', () => {
    expect(classify({ rttMs: 10, uplinkLossPct: 0, downlinkLossPct: 12 })).toBe('dire')
  })

  it('reports offline regardless of how good the last sample looked', () => {
    expect(classify({ rttMs: 5, uplinkLossPct: 0 }, false)).toBe('offline')
  })

  it('treats missing fields as healthy rather than guessing', () => {
    expect(classify({})).toBe('good')
  })
})

describe('bottleneckOf', () => {
  it('separates cpu from the network entirely', () => {
    expect(bottleneckOf({ limitedBy: 'cpu', uplinkLossPct: 20 })).toBe('cpu')
  })

  it('names uplink when the encoder is bandwidth-limited and our send is lossier', () => {
    expect(bottleneckOf({ limitedBy: 'bandwidth', uplinkLossPct: 9, downlinkLossPct: 1 })).toBe('uplink')
  })

  it('names downlink when the receive side is the lossy one', () => {
    expect(bottleneckOf({ limitedBy: 'bandwidth', uplinkLossPct: 0, downlinkLossPct: 7 })).toBe('downlink')
  })

  it('stays quiet on a healthy sample', () => {
    expect(bottleneckOf({ rttMs: 20, uplinkLossPct: 0, downlinkLossPct: 0 })).toBe('none')
  })
})

describe('settle', () => {
  const feed = (start: NetworkTier, tiers: NetworkTier[]) =>
    tiers.reduce((s, t) => settle(s, t), initialSettler(start))

  it('holds the old tier until the degrade streak is met', () => {
    let s = initialSettler('good')
    for (let i = 0; i < DEGRADE_SAMPLES - 1; i++) {
      s = settle(s, 'dire')
      expect(s.tier).toBe('good')
    }
    s = settle(s, 'dire')
    expect(s.tier).toBe('dire')
  })

  it('needs a much longer streak to recover than to degrade', () => {
    expect(RECOVER_SAMPLES).toBeGreaterThan(DEGRADE_SAMPLES)
    let s = initialSettler('dire')
    for (let i = 0; i < RECOVER_SAMPLES - 1; i++) s = settle(s, 'good')
    expect(s.tier).toBe('dire')
    s = settle(s, 'good')
    expect(s.tier).toBe('good')
  })

  it('resets the streak when the candidate changes, so it cannot flap through', () => {
    // Alternating bad samples must never accumulate into a change.
    const s = feed('good', ['dire', 'weak', 'dire', 'weak', 'dire', 'weak'])
    expect(s.tier).toBe('good')
  })

  it('reports offline immediately — it is a fact, not an inference', () => {
    const s = settle(initialSettler('good'), 'offline')
    expect(s.tier).toBe('offline')
  })

  it('still makes recovery from offline earn its streak', () => {
    let s = initialSettler('offline')
    s = settle(s, 'good')
    expect(s.tier).toBe('offline')
    for (let i = 0; i < RECOVER_SAMPLES - 1; i++) s = settle(s, 'good')
    expect(s.tier).toBe('good')
  })

  it('clears the streak once a tier is confirmed', () => {
    let s = initialSettler('good')
    for (let i = 0; i < DEGRADE_SAMPLES; i++) s = settle(s, 'dire')
    expect(s).toEqual({ tier: 'dire', candidate: 'dire', streak: 0 })
  })
})
