import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

export const isLocalCam = (t: TrackReferenceOrPlaceholder) =>
  t.participant.isLocal && t.source === Track.Source.Camera

export const isScreenShare = (t: TrackReferenceOrPlaceholder) => t.source === Track.Source.ScreenShare

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
