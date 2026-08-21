import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

export const isLocalCam = (t: TrackReferenceOrPlaceholder) =>
  t.participant.isLocal && t.source === Track.Source.Camera

export const isScreenShare = (t: TrackReferenceOrPlaceholder) => t.source === Track.Source.ScreenShare

/** Stable per-tile key (identity + source) — never reshuffles as people speak.
 *  Lives here rather than in Stage so the presentation-state keys and the code
 *  that interprets them (isShareKey) can't drift apart. */
export function tileKey(t: TrackReferenceOrPlaceholder): string {
  return `${t.participant.identity}-${t.source}`
}

/** Does a spotlight key point at a screen share rather than a person? */
export const isShareKey = (key: string) => key.endsWith(`-${Track.Source.ScreenShare}`)

/** Identity of a share for presentation state: its track SID, or the tile key
 *  before a SID exists. Matches what Stage stores in `demotedShares`. */
export const shareId = (t: TrackReferenceOrPlaceholder) => t.publication?.trackSid ?? tileKey(t)

/**
 * Is a screen share currently occupying the BIG region — the one thing that
 * decides whether there is a surface to draw on?
 *
 * Three surfaces used to answer this question separately and disagree. The control
 * bar offered the pen whenever a share merely EXISTED, so spotlighting a person or
 * demoting the share left an enabled pen with no canvas mounted anywhere — arming it
 * flipped a store flag and told a screen-reader user "Draw on the shared screen"
 * when there was nothing to draw on. Stage mounted the canvas on `bigIsShare`, and
 * the tile's own pen button on something else again.
 *
 * One definition, consumed by all of them (via useSharePresence).
 */
export function featuredShare(
  shares: TrackReferenceOrPlaceholder[],
  opts: { demotedShares: string[]; spotlightKey: string | null; stickyShareId: string | null },
): TrackReferenceOrPlaceholder | undefined {
  const share = primaryShare(shares, opts.stickyShareId)
  if (!share) return undefined
  if (opts.demotedShares.includes(shareId(share))) return undefined
  // A person-spotlight displaces the share from the big region; a share-spotlight
  // (or no spotlight at all) leaves a share in it.
  if (opts.spotlightKey && !isShareKey(opts.spotlightKey)) return undefined
  return share
}

/** Boolean form of featuredShare — "is there a surface to draw on right now". */
export function shareIsFeatured(
  shares: TrackReferenceOrPlaceholder[],
  opts: { demotedShares: string[]; spotlightKey: string | null; stickyShareId: string | null },
): boolean {
  return featuredShare(shares, opts) !== undefined
}

/**
 * Choose which screen share to feature in the presentation big slot when more than one
 * person is sharing. A share whose publisher is currently speaking wins (they're likely
 * the one being discussed); otherwise a stable order by identity+source, so the featured
 * share doesn't flip around as the track list re-emits. Returns undefined if none.
 */
export function primaryShare(
  tracks: TrackReferenceOrPlaceholder[],
  /** Required, not optional, and deliberately so: an omitted sticky id silently
   *  re-picks on `isSpeaking`, which is exactly the bug this parameter exists to
   *  prevent. Callers with genuinely no stored choice pass `null` and say so. */
  stickyId: string | null,
): TrackReferenceOrPlaceholder | undefined {
  const shares = tracks.filter(isScreenShare)
  if (shares.length <= 1) return shares[0]
  // Once a share has the big region it KEEPS it until it ends or someone switches
  // deliberately. Re-picking on `isSpeaking` meant that with two presenters the
  // featured share swapped every time they took a turn talking — under live ink,
  // which is addressed in unit coordinates against whatever is currently featured.
  // Strokes drawn on one screen therefore landed on the other. Speaking is a fine
  // tie-break for choosing; it is a bad reason to re-aim a shared drawing surface.
  if (stickyId) {
    const held = shares.find((t) => shareId(t) === stickyId)
    if (held) return held
  }
  return [...shares].sort((a, b) => {
    const spk = Number(b.participant.isSpeaking) - Number(a.participant.isSpeaking)
    if (spk) return spk
    return tileKey(a).localeCompare(tileKey(b))
  })[0]
}

/** Pick the focused track: explicit pin > active screen share > active speaker > first. */
export function focusTrack(
  tracks: TrackReferenceOrPlaceholder[],
  pinned: string | null,
): TrackReferenceOrPlaceholder | undefined {
  if (pinned) {
    const byPin =
      tracks.find((t) => t.participant.identity === pinned && t.source === Track.Source.Camera) ??
      tracks.find((t) => t.participant.identity === pinned)
    if (byPin) return byPin
  }
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare)
  if (screen) return screen
  const speaking = tracks.find((t) => t.participant.isSpeaking)
  return speaking ?? tracks[0]
}

/**
 * Which track the stage's BIG region shows — the one definition, so the desktop
 * speaker stage and the touch stage can't answer it differently.
 *
 * An explicit pin wins even when it's YOU. Both stages used to call
 * `focusTrack(others, pinned)` with their own camera filtered out, and that filter
 * is right for the AUTOMATIC picks — being the loudest voice in the room, or simply
 * first in the list, is no reason to full-bleed you to yourself. It was never meant
 * to make you unpinnable, but it did: because you weren't in the list, pinning
 * yourself fell straight through to the active speaker. `togglePin` then switched
 * the layout to speaker, so asking to watch yourself put SOMEBODY ELSE on the whole
 * screen while your own tile carried the "pinned" label.
 *
 * That was reachable before by double-clicking your desktop grid tile or
 * long-pressing the touch self-view card; it became the obvious thing to do when
 * the touch gallery started giving you a cell, since "double-tap a video to pin" is
 * exactly what the coachmark teaches.
 *
 * `selfViewHidden` outranks a pin on yourself, and has to: the two can only be set
 * together in one order (pin, then hide — with yourself hidden there is no tile of
 * yours left to pin from), and a setting called "hide self view" that leaves you
 * full-bleed is a setting that looks broken. The pin is remembered, not discarded,
 * so unhiding brings you back.
 *
 * The `?? localCam` tail is the other half, and it ignores `selfViewHidden` on
 * purpose: it keeps the big region filled in a call where nobody else has published
 * a camera, the same way the desktop grid keeps your tile when it is the only one.
 * Seeing yourself beats an empty stage.
 */
export function stageFocus(
  visible: TrackReferenceOrPlaceholder[],
  pinned: string | null,
  selfViewHidden = false,
): TrackReferenceOrPlaceholder | undefined {
  const localCam = visible.find(isLocalCam)
  if (localCam && pinned && pinned === localCam.participant.identity && !selfViewHidden) {
    return localCam
  }
  return focusTrack(visible.filter((t) => !isLocalCam(t)), pinned) ?? localCam
}

/** Whether a track ref currently has displayable video (mute + subscription aware). */
export function hasVideo(t: TrackReferenceOrPlaceholder): boolean {
  const pub = t.publication
  return !!pub && !pub.isMuted && (t.participant.isLocal || !!pub.isSubscribed)
}
