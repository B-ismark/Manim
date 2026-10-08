/**
 * Who holds the speaker view's big region — and when someone else takes it.
 *
 * The big region used to be `tracks.find(isSpeaking) ?? tracks[0]`, recomputed on
 * every render. `isSpeaking` drops at every breath, so the moment a speaker paused
 * the stage fell back to `tracks[0]` (whoever joined first) and then flipped back
 * when they carried on. Each flip is not just a visual cut: the incoming feed had
 * been paused by adaptiveStream while it wasn't on screen, so it arrives black or
 * frozen, waits for a keyframe, then climbs up from the lowest simulcast layer —
 * roughly half a second to a second and a half of a broken picture, several times
 * a sentence. Every flip also asks the publisher for a keyframe, and those bursts
 * land on everybody's uplink. People called it lag.
 *
 * The rule now (Meet and Teams behave the same way):
 *  - The last person to speak KEEPS the region through their pauses, for as long
 *    as they're in the call. Silence never hands it to anyone.
 *  - Someone else takes it only after speaking for `dwellMs`. Short gaps in their
 *    speech (under `graceMs`) don't reset that clock; a longer one does, so a "yes"
 *    two minutes ago doesn't count towards a takeover now.
 *  - With nobody held yet (start of a call, or the holder just left), the first
 *    voice takes it at once — there is no picture worth protecting.
 *
 * Pure and clock-injected so the timing can be unit-tested; `useHeldSpeaker` runs it.
 */

/** How long a new voice must keep talking before the stage cuts to them. */
export const SPEAKER_DWELL_MS = 1500
/** A pause shorter than this doesn't restart a challenger's dwell. */
export const SPEAKER_GRACE_MS = 1000

export interface SpeakerHold {
  /** Identity in the big region, or null for "nobody chosen yet". */
  held: string | null
  /** Who is working towards taking it. */
  challenger: string | null
  /** When the challenger's current run of speech began. */
  since: number
  /** Last time the challenger was seen speaking (or stopped speaking). */
  lastHeard: number
  /** Whether the challenger was speaking at the previous evaluation. */
  heard: boolean
}

export const NO_HOLD: SpeakerHold = { held: null, challenger: null, since: 0, lastHeard: 0, heard: false }

/**
 * @param speaking remote identities speaking right now, loudest first
 * @param present  whether an identity is still in the call
 */
export function nextSpeakerHold(
  prev: SpeakerHold,
  speaking: readonly string[],
  present: (identity: string) => boolean,
  now: number,
  dwellMs = SPEAKER_DWELL_MS,
  graceMs = SPEAKER_GRACE_MS,
): SpeakerHold {
  const held = prev.held && present(prev.held) ? prev.held : null
  if (!held) return { ...NO_HOLD, held: speaking[0] ?? null }
  if (speaking.includes(held)) return { ...NO_HOLD, held }

  let { challenger, since, lastHeard } = prev
  if (challenger && !present(challenger)) challenger = null
  // A challenger who has been quiet for longer than the grace period starts over.
  if (challenger && !prev.heard && now - lastHeard > graceMs) challenger = null

  const talking = challenger && speaking.includes(challenger) ? challenger : speaking[0]
  if (!talking) {
    // Nobody but silence: the holder keeps it. Mark when the challenger stopped,
    // so the grace period runs from the end of their speech, not its start.
    if (!challenger) return { ...NO_HOLD, held }
    return { held, challenger, since, lastHeard: prev.heard ? now : lastHeard, heard: false }
  }
  if (talking !== challenger) {
    challenger = talking
    since = now
  }
  if (now - since >= dwellMs) return { ...NO_HOLD, held: challenger }
  return { held, challenger, since, lastHeard: now, heard: true }
}

/** When to evaluate again so a continuous speaker is promoted on time (null: no need). */
export function nextCheckIn(hold: SpeakerHold, now: number, dwellMs = SPEAKER_DWELL_MS): number | null {
  if (!hold.challenger || !hold.heard) return null
  return Math.max(0, hold.since + dwellMs - now)
}
