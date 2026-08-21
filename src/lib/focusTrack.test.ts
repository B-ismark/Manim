import { describe, it, expect } from 'vitest'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import {
  focusTrack,
  hasVideo,
  isShareKey,
  primaryShare,
  shareIsFeatured,
  stageFocus,
  tileKey,
} from './focusTrack'

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

describe('stageFocus', () => {
  const me = ref({ identity: 'me', isLocal: true })
  const a = ref({ identity: 'a' })
  const b = ref({ identity: 'b', speaking: true })

  it('honours a pin on YOURSELF — the bug that shipped for months', () => {
    // Both stages filtered the local camera out before asking, so a pin on yourself
    // fell through to the active speaker. Since togglePin also switches the layout
    // to speaker, asking to watch yourself put somebody else on the whole screen.
    expect(stageFocus([me, a, b], 'me')).toBe(me)
  })

  it('still honours a pin on someone else', () => {
    expect(stageFocus([me, a, b], 'a')).toBe(a)
  })

  it('never picks you automatically, even when you are the one speaking', () => {
    // The reason the filter exists: being the loudest voice in the room is no
    // reason to full-bleed you to yourself. Only an explicit pin may do that.
    const loudMe = ref({ identity: 'me', isLocal: true, speaking: true })
    expect(stageFocus([loudMe, a], null)).toBe(a)
  })

  it('never picks you automatically as the mere first tile either', () => {
    expect(stageFocus([me, a], null)).toBe(a)
  })

  it('falls back to your own camera when there is nobody else', () => {
    expect(stageFocus([me], null)).toBe(me)
  })

  it('a screen share still outranks the active speaker', () => {
    const screen = ref({ identity: 'a', source: Track.Source.ScreenShare })
    expect(stageFocus([me, b, screen], null)).toBe(screen)
  })

  it('a pin on yourself outranks even a live screen share', () => {
    // Consistent with focusTrack, where an explicit pin is the top of the order.
    const screen = ref({ identity: 'a', source: Track.Source.ScreenShare })
    expect(stageFocus([me, b, screen], 'me')).toBe(me)
  })

  it('hiding your self-view outranks a pin on yourself', () => {
    // Only reachable in one order — pin, then hide — because with yourself hidden
    // there is no tile of yours left to pin from. A setting called "hide self view"
    // that leaves you full-bleed is a setting that looks broken.
    expect(stageFocus([me, a, b], 'me', true)).toBe(b)
  })

  it('…but a hidden self-view still fills an otherwise empty stage', () => {
    // Same rule the desktop grid keeps: your tile survives when it is the only one.
    expect(stageFocus([me], 'me', true)).toBe(me)
  })

  it('is undefined only when there is nothing at all to show', () => {
    expect(stageFocus([], 'me')).toBeUndefined()
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
  const none = { demotedShares: [], spotlightKey: null, stickyShareId: null }

  it('false when nobody is sharing', () => {
    expect(shareIsFeatured([], none)).toBe(false)
  })

  it('true for a plain, undemoted, unspotlit share', () => {
    expect(shareIsFeatured([share], none)).toBe(true)
  })

  it('false once the viewer demotes that share to the grid', () => {
    const sid = share.publication!.trackSid ?? tileKey(share)
    expect(shareIsFeatured([share], { demotedShares: [sid], spotlightKey: null, stickyShareId: null })).toBe(false)
  })

  it('false while a PERSON is spotlighted — they displace the share', () => {
    expect(shareIsFeatured([share], { demotedShares: [], spotlightKey: tileKey(cam), stickyShareId: null })).toBe(false)
  })

  it('true while a SHARE is spotlighted — a share is still in the big region', () => {
    expect(shareIsFeatured([share], { demotedShares: [], spotlightKey: tileKey(share), stickyShareId: null })).toBe(true)
  })

  it('a demoted share does not suppress a second, undemoted one', () => {
    const other = ref({ identity: 'c', source: Track.Source.ScreenShare })
    const sid = tileKey(share)
    // primaryShare picks by identity order, so 'a' wins and is the one demoted.
    expect(shareIsFeatured([share, other], { demotedShares: [sid], spotlightKey: null, stickyShareId: null })).toBe(false)
    expect(shareIsFeatured([other], { demotedShares: [sid], spotlightKey: null, stickyShareId: null })).toBe(true)
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

/**
 * The featured share must not move because somebody started talking.
 *
 * Ink travels in unit coordinates against whatever share is featured, so re-picking
 * on `isSpeaking` meant that with two presenters the target swapped mid-stroke and
 * everyone's drawing landed on the other person's screen.
 */
describe('primaryShare stickiness', () => {
  const shareA = ref({ identity: 'a', source: Track.Source.ScreenShare })
  const shareB = ref({ identity: 'b', source: Track.Source.ScreenShare, speaking: true })

  it('without a sticky id, a speaking publisher wins (the old behaviour)', () => {
    expect(primaryShare([shareA, shareB], null)).toBe(shareB)
  })

  it('a held share keeps the big region even while the other publisher speaks', () => {
    expect(primaryShare([shareA, shareB], tileKey(shareA))).toBe(shareA)
  })

  it('falls back cleanly when the held share has ended', () => {
    expect(primaryShare([shareB], tileKey(shareA))).toBe(shareB)
  })

  it('a single share ignores stickiness entirely', () => {
    expect(primaryShare([shareA], tileKey(shareB))).toBe(shareA)
  })

  it('stickiness flows through featuredShare', () => {
    const held = { demotedShares: [], spotlightKey: null, stickyShareId: tileKey(shareA) }
    expect(shareIsFeatured([shareA, shareB], held)).toBe(true)
    // ...but a demote still wins over a hold — the viewer asked for the grid.
    expect(
      shareIsFeatured([shareA, shareB], { ...held, demotedShares: [tileKey(shareA)] }),
    ).toBe(false)
  })
})
