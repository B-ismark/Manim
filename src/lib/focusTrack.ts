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
export function shareIsFeatured(
  shares: TrackReferenceOrPlaceholder[],
  opts: { demotedShares: string[]; spotlightKey: string | null },
): boolean {
  const share = primaryShare(shares)
  if (!share) return false
  if (opts.demotedShares.includes(shareId(share))) return false
  // A person-spotlight displaces the share from the big region; a share-spotlight
  // (or no spotlight at all) leaves a share in it.
  if (opts.spotlightKey && !isShareKey(opts.spotlightKey)) return false
  return true
}

/**
 * Choose which screen share to feature in the presentation big slot when more than one
 * person is sharing. A share whose publisher is currently speaking wins (they're likely
 * the one being discussed); otherwise a stable order by identity+source, so the featured
 * share doesn't flip around as the track list re-emits. Returns undefined if none.
 */
export function primaryShare(
  tracks: TrackReferenceOrPlaceholder[],
): TrackReferenceOrPlaceholder | undefined {
  const shares = tracks.filter(isScreenShare)
  if (shares.length <= 1) return shares[0]
  return [...shares].sort((a, b) => {
    const spk = Number(b.participant.isSpeaking) - Number(a.participant.isSpeaking)
    if (spk) return spk
    return `${a.participant.identity}-${a.source}`.localeCompare(`${b.participant.identity}-${b.source}`)
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
