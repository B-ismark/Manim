import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScreenSharePresets } from 'livekit-client'

// `roomOptions` pulls in a Vite worker import that has no meaning in Node, and
// `isMobile()` reads a navigator that does not exist here. Both are stubbed so the
// pure part — which preset ends up on which publish path — can be asserted.
vi.mock('livekit-client/e2ee-worker?worker', () => ({ default: class {} }))

const isMobile = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/lib/device', () => ({ isMobile }))

const { roomOptions } = await import('./livekit')

/** publishDefaults for a given (lowBandwidth, e2ee, mobile) combination. */
function pub(opts: { low?: boolean; e2ee?: boolean; mobile?: boolean } = {}) {
  isMobile.mockReturnValue(Boolean(opts.mobile))
  return roomOptions(Boolean(opts.low), opts.e2ee ? 'passphrase' : undefined).publishDefaults!
}

beforeEach(() => isMobile.mockReturnValue(false))

describe('roomOptions — screen-share cost', () => {
  it('drops the share to 720p/5fps in low-bandwidth mode', () => {
    // The one real behaviour change: low-bandwidth used to degrade CAMERAS only,
    // so a user on a metered link still received a full 1080p/15 screen share.
    expect(pub({ low: true }).screenShareEncoding).toEqual(ScreenSharePresets.h720fps5.encoding)
  })

  it('pins the normal share cap to the value livekit-client currently defaults to', () => {
    // Deliberately equal to the library default — set explicitly so a dependency
    // bump cannot silently change what a share looks like. If this ever fails,
    // livekit-client moved its default and that is the thing to go read.
    expect(pub().screenShareEncoding).toEqual(ScreenSharePresets.h1080fps15.encoding)
  })

  it('gives VP8 publishers a share ladder so a thumbnail can take 360p', () => {
    for (const opts of [{ e2ee: true }, { mobile: true }]) {
      const layers = pub(opts).screenShareSimulcastLayers
      expect(layers, JSON.stringify(opts)).toEqual([
        ScreenSharePresets.h360fps15,
        ScreenSharePresets.h720fps15,
      ])
    }
  })

  it('omits the ladder on the VP9 path, where LiveKit would ignore it anyway', () => {
    // Not an oversight — an assertion of the asymmetry. For an SVC codec on a
    // ScreenShare track livekit-client forces scalabilityMode 'L1T3' ("vp9 svc
    // with screenshare cannot encode multiple spatial layers") and returns from
    // the SVC branch of computeVideoEncodings before reading this option. Setting
    // it here would read as protection that does not exist.
    const desktop = pub()
    expect(desktop.videoCodec).toBe('vp9')
    expect(desktop.screenShareSimulcastLayers).toBeUndefined()
  })

  it('keeps the ladder within the three simulcast rids LiveKit can address', () => {
    // encodingsFromPresets stops at videoRids.length (3), and the publish encoding
    // itself occupies one. More than two presets here would be silently dropped.
    expect(pub({ e2ee: true }).screenShareSimulcastLayers!.length).toBeLessThanOrEqual(2)
  })

  it('orders the ladder low → high, which is what encodingsFromPresets assumes', () => {
    const layers = pub({ e2ee: true }).screenShareSimulcastLayers!
    const heights = layers.map((l) => l.height)
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
  })
})

describe('roomOptions — codec selection', () => {
  it('uses VP9 with a VP8 backup on desktop without E2EE', () => {
    const p = pub()
    expect(p.videoCodec).toBe('vp9')
    expect(p.backupCodec).toEqual({ codec: 'vp8' })
  })

  it('pins phones and every E2EE room to VP8 with no backup codec', () => {
    // VP9 SVC on mobile hardware encoders is the discoloration/heat offender, and
    // insertable streams alongside VP9 SVC are flaky off-Chromium. If this ever
    // goes green with 'vp9', the discoloration bug is back.
    for (const opts of [{ mobile: true }, { e2ee: true }, { mobile: true, e2ee: true }]) {
      const p = pub(opts)
      expect(p.videoCodec, JSON.stringify(opts)).toBe('vp8')
      expect(p.backupCodec, JSON.stringify(opts)).toBeUndefined()
    }
  })

  it('keeps maintain-resolution so text sheds frame rate, not sharpness', () => {
    expect(pub().degradationPreference).toBe('maintain-resolution')
  })
})

describe('roomOptions — camera capture', () => {
  it('captures 720p normally and 360p in low-bandwidth mode', () => {
    expect(roomOptions(false).videoCaptureDefaults!.resolution!.height).toBe(720)
    expect(roomOptions(true).videoCaptureDefaults!.resolution!.height).toBe(360)
  })

  it('drops the top camera layer in low-bandwidth mode', () => {
    expect(pub({ low: true }).videoSimulcastLayers).toHaveLength(2)
    expect(pub().videoSimulcastLayers).toHaveLength(3)
  })
})

describe('roomOptions — low-bandwidth share cost', () => {
  it('turns simulcast OFF in low-bandwidth mode', () => {
    // Measured: leaving it on made an E2EE share cost 1225-1257 kbps, twice the
    // 620 kbps of the non-E2EE path, in the mode that exists to save bandwidth.
    // LiveKit always appends a source-resolution layer to any ladder, so no
    // choice of presets fixes it — only publishing one layer does (430-503 kbps).
    expect(pub({ low: true }).simulcast).toBe(false)
    expect(pub({ low: true, e2ee: true }).simulcast).toBe(false)
  })

  it('keeps simulcast on everywhere else', () => {
    for (const o of [{}, { e2ee: true }, { mobile: true }]) {
      expect(pub(o).simulcast, JSON.stringify(o)).toBe(true)
    }
  })

  it('drops the share ladder in low-bandwidth, since nothing would read it', () => {
    expect(pub({ low: true, e2ee: true }).screenShareSimulcastLayers).toBeUndefined()
  })
})
