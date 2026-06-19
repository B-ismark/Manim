import { describe, it, expect } from 'vitest'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { focusTrack, hasVideo } from './focusTrack'

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
