import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

export const isLocalCam = (t: TrackReferenceOrPlaceholder) =>
  t.participant.isLocal && t.source === Track.Source.Camera

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
