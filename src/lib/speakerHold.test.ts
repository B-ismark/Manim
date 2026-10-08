import { describe, it, expect } from 'vitest'
import { NO_HOLD, nextCheckIn, nextSpeakerHold, type SpeakerHold, SPEAKER_DWELL_MS, SPEAKER_GRACE_MS } from './speakerHold'

const everyone = () => true

/** Run a script of [time, speaking] steps through the rule; return the final hold. */
function play(steps: Array<[number, string[]]>, present: (id: string) => boolean = everyone, start = NO_HOLD) {
  let h: SpeakerHold = start
  const trail: Array<string | null> = []
  for (const [t, speaking] of steps) {
    h = nextSpeakerHold(h, speaking, present, t)
    trail.push(h.held)
  }
  return { h, trail }
}

describe('nextSpeakerHold', () => {
  it('the first voice takes an empty stage at once', () => {
    expect(play([[0, ['a']]]).h.held).toBe('a')
  })

  it('a pause never hands the stage to anybody — the bug that read as lag', () => {
    // a talks, breathes, talks: the old rule fell back to tracks[0] at every breath.
    const { trail } = play([
      [0, ['a']],
      [400, []],
      [600, ['a']],
      [900, []],
      [60_000, []],
    ])
    expect(trail.every((h) => h === 'a')).toBe(true)
  })

  it('a short interjection does not move the stage', () => {
    const { trail } = play([
      [0, ['a']],
      [1000, ['b']],
      [1600, []],
      [1700, ['a']],
    ])
    expect(trail).toEqual(['a', 'a', 'a', 'a'])
  })

  it('someone who keeps talking past the dwell takes it', () => {
    const { h } = play([
      [0, ['a']],
      [1000, ['b']],
      [1000 + SPEAKER_DWELL_MS, ['b']],
    ])
    expect(h.held).toBe('b')
  })

  it('brief gaps in a challenger’s speech do not restart their clock', () => {
    const { h } = play([
      [0, ['a']],
      [1000, ['b']],
      [1500, []],
      [1500 + SPEAKER_GRACE_MS - 100, ['b']],
      [1000 + SPEAKER_DWELL_MS, ['b']],
    ])
    expect(h.held).toBe('b')
  })

  it('a long silence does restart it — an old "yes" is not a takeover', () => {
    const { h } = play([
      [0, ['a']],
      [1000, ['b']],
      [1200, []],
      [1200 + SPEAKER_GRACE_MS + 500, ['b']],
    ])
    expect(h.held).toBe('a')
    expect(h.since).toBe(1200 + SPEAKER_GRACE_MS + 500)
  })

  it('the holder speaking again cancels a challenge', () => {
    const { h } = play([
      [0, ['a']],
      [1000, ['b']],
      [1200, ['a', 'b']],
      [1000 + SPEAKER_DWELL_MS, ['b']],
    ])
    expect(h.held).toBe('a')
  })

  it('when the holder leaves, the current voice takes over immediately', () => {
    const present = (id: string) => id !== 'a'
    const start: SpeakerHold = { ...NO_HOLD, held: 'a' }
    expect(nextSpeakerHold(start, ['b'], present, 0).held).toBe('b')
    expect(nextSpeakerHold(start, [], present, 0).held).toBeNull()
  })
})

describe('nextCheckIn', () => {
  it('asks to be re-run when an active challenger’s dwell ends', () => {
    const h = nextSpeakerHold({ ...NO_HOLD, held: 'a' }, ['b'], everyone, 100)
    expect(nextCheckIn(h, 100)).toBe(SPEAKER_DWELL_MS)
  })

  it('needs no timer with no challenger', () => {
    expect(nextCheckIn({ ...NO_HOLD, held: 'a' }, 0)).toBeNull()
  })
})
