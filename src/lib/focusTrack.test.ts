import { describe, it, expect } from 'vitest'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { focusTrack, hasVideo, isShareKey, shareIsFeatured, tileKey } from './focusTrack'

// Minimal stand-in for a track ref — focusTrack/hasVideo only read identity,
// source, isSpeaking/isLocal and the publication's mute/subscription flags.
function ref(opts: {
  identity: string
  source?: Track.Source
  speaking?: boolean
  isLocal?: boolean
  muted?: boolean
  subscribed?: boolean
  hasPub?: boolean
}): TrackReferenceOrPlaceholder {
  return {
    participant: {
      identity: opts.identity,
      isSpeaking: opts.speaking ?? false,
      isLocal: opts.isLocal ?? false,
    },
    source: opts.source ?? Track.Source.Camera,
    publication:
      opts.hasPub === false
        ? undefined
        : { isMuted: opts.muted ?? false, isSubscribed: opts.subscribed ?? true },
  } as unknown as TrackReferenceOrPlaceholder
}

describe('focusTrack', () => {
  const a = ref({ identity: 'a' })
  const b = ref({ identity: 'b' })

  it('honours an explicit pin (camera track of the pinned identity)', () => {
    const screen = ref({ identity: 'b', source: Track.Source.ScreenShare })
    expect(focusTrack([a, b, screen], 'a')).toBe(a)
  })

  it('pin falls back to any track of the pinned identity if no camera', () => {
    const screenOnly = ref({ identity: 'c', source: Track.Source.ScreenShare })
    expect(focusTrack([a, screenOnly], 'c')).toBe(screenOnly)
  })

  it('screen share beats active speaker when nothing is pinned', () => {
    const speaker = ref({ identity: 'a', speaking: true })
    const screen = ref({ identity: 'b', source: Track.Source.ScreenShare })
    expect(focusTrack([speaker, screen], null)).toBe(screen)
  })

  it('active speaker beats first when no pin/screen', () => {
    const speaker = ref({ identity: 'b', speaking: true })
    expect(focusTrack([a, speaker], null)).toBe(speaker)
  })

  it('falls back to the first track', () => {
    expect(focusTrack([a, b], null)).toBe(a)
  })

  it('returns undefined for an empty list', () => {
    expect(focusTrack([], null)).toBeUndefined()
  })

  it('ignores a stale pin for an absent identity (falls through)', () => {
    expect(focusTrack([a, b], 'ghost')).toBe(a)
  })
})

describe('hasVideo', () => {
  it('true for a subscribed, unmuted remote publication', () => {
    expect(hasVideo(ref({ identity: 'a', subscribed: true, muted: false }))).toBe(true)
  })

  it('false when muted', () => {
    expect(hasVideo(ref({ identity: 'a', muted: true }))).toBe(false)
  })

  it('false when there is no publication (placeholder)', () => {
    expect(hasVideo(ref({ identity: 'a', hasPub: false }))).toBe(false)
  })

  it('local track does not require a subscription', () => {
    expect(hasVideo(ref({ identity: 'a', isLocal: true, subscribed: false }))).toBe(true)
  })

  it('remote unsubscribed track has no displayable video', () => {
    expect(hasVideo(ref({ identity: 'a', isLocal: false, subscribed: false }))).toBe(false)
  })
})

/**
 * "Is a share in the big region right now" — the single condition the drawing
 * canvas mounts on, the pen buttons render on, and the pen disarms on.
 *
 * It used to be three separate answers. The control bar asked "does a share exist
 * anywhere", so demoting the share to the grid or spotlighting a person left an
 * enabled pen with no canvas under it: arming it flipped a store flag and announced
 * "Draw on the shared screen" to a screen-reader user who had no surface at all.
 */
describe('shareIsFeatured', () => {
  const share = ref({ identity: 'a', source: Track.Source.ScreenShare })
  const cam = ref({ identity: 'b' })
  const none = { demotedShares: [], spotlightKey: null }

  it('false when nobody is sharing', () => {
    expect(shareIsFeatured([], none)).toBe(false)
  })

  it('true for a plain, undemoted, unspotlit share', () => {
    expect(shareIsFeatured([share], none)).toBe(true)
  })

  it('false once the viewer demotes that share to the grid', () => {
    const sid = share.publication!.trackSid ?? tileKey(share)
    expect(shareIsFeatured([share], { demotedShares: [sid], spotlightKey: null })).toBe(false)
  })

  it('false while a PERSON is spotlighted — they displace the share', () => {
    expect(shareIsFeatured([share], { demotedShares: [], spotlightKey: tileKey(cam) })).toBe(false)
  })

  it('true while a SHARE is spotlighted — a share is still in the big region', () => {
    expect(shareIsFeatured([share], { demotedShares: [], spotlightKey: tileKey(share) })).toBe(true)
  })

  it('a demoted share does not suppress a second, undemoted one', () => {
    const other = ref({ identity: 'c', source: Track.Source.ScreenShare })
    const sid = tileKey(share)
    // primaryShare picks by identity order, so 'a' wins and is the one demoted.
    expect(shareIsFeatured([share, other], { demotedShares: [sid], spotlightKey: null })).toBe(false)
    expect(shareIsFeatured([other], { demotedShares: [sid], spotlightKey: null })).toBe(true)
  })
})

describe('isShareKey', () => {
  it('distinguishes a share tile key from a person tile key', () => {
    expect(isShareKey(tileKey(ref({ identity: 'a', source: Track.Source.ScreenShare })))).toBe(true)
    expect(isShareKey(tileKey(ref({ identity: 'a' })))).toBe(false)
  })

  it('is not fooled by an identity that ends in the source name', () => {
    expect(isShareKey(tileKey(ref({ identity: 'screen_share' })))).toBe(false)
  })
})
