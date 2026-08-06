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

/** Whether a track ref currently has displayable video (mute + subscription aware). */
export function hasVideo(t: TrackReferenceOrPlaceholder): boolean {
  const pub = t.publication
  return !!pub && !pub.isMuted && (t.participant.isLocal || !!pub.isSubscribed)
}
