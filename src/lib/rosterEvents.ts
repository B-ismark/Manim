import { RoomEvent } from 'livekit-client'

/**
 * The events a roster — a `useTracks` / `useParticipants` list — refreshes on: the
 * library's default set (components-core `allParticipantRoomEvents`) minus the two
 * that tick all call long and that a list itself doesn't show.
 *
 * `ActiveSpeakersChanged` fires several times a second in a lively call, and each
 * one redrew the whole stage and every tile in it, video elements included (and
 * the mini player, and the people list), to move one speaking ring.
 * `ConnectionQualityChanged` arrives every few seconds per person for a
 * signal-bars icon. The pieces that genuinely follow them subscribe
 * themselves, so only they redraw: each tile's ring (`useIsSpeaking`) and bars
 * (`ConnectionQuality`), the gallery's off-page chip (`SpeakerOffPage`), and the
 * big region, whose held speaker runs off the room's own events (useHeldSpeaker).
 *
 * Two tie-breaks still read `isSpeaking` off a list that no longer refreshes for
 * it, and both are fine stale: `primaryShare` only consults it for the FIRST pick
 * among two or more shares (after that the sticky id decides), and `focusTrack`
 * only falls back to it when no one holds the speaker slot.
 *
 * Every `useTracks` in the app passes this — one left on the defaults re-renders
 * whatever calls it (useSharePresence is called by Stage, RoomView and ControlBar).
 */
export const ROSTER_EVENTS: RoomEvent[] = [
  RoomEvent.ConnectionStateChanged,
  RoomEvent.RoomMetadataChanged,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantPermissionsChanged,
  RoomEvent.ParticipantMetadataChanged,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.ParticipantAttributesChanged,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackStreamStateChanged,
  RoomEvent.TrackSubscriptionFailed,
  RoomEvent.TrackSubscriptionPermissionChanged,
  RoomEvent.TrackSubscriptionStatusChanged,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
]
