import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import {
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteTrackPublication,
} from 'livekit-client'

/**
 * Cap every incoming camera at the LOW simulcast layer while `cap` is true.
 *
 * Two reasons to want it, one mechanism:
 *  - Low-bandwidth mode. It used to cut only what you SEND (camera off, one share
 *    layer) and still downloaded everyone else's video at whatever adaptiveStream
 *    picked for the tile. On the metered or weak link the mode exists for, the
 *    downlink is half the problem.
 *  - A device out of CPU (useDeviceStrain). Decoding 720p for every tile is real
 *    work; the smallest layer is a fraction of it.
 *
 * `setVideoQuality` sets a CEILING the SFU honours alongside adaptiveStream, so a
 * tile still only gets what its size needs, never more than LOW. Cameras only:
 * a screen share is text, and the low layer of one is unreadable. Lifting the cap
 * hands control back to adaptiveStream (HIGH = no ceiling).
 */
export function useIncomingVideoCap(cap: boolean): void {
  const room = useRoomContext()

  useEffect(() => {
    if (!cap) return
    const each = (fn: (pub: RemoteTrackPublication) => void) => {
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) fn(pub)
      }
    }
    const set = (quality: VideoQuality) => (pub: RemoteTrackPublication) => {
      if (pub.kind !== Track.Kind.Video || pub.source !== Track.Source.Camera) return
      if (!pub.isSubscribed) return
      pub.setVideoQuality(quality)
    }
    each(set(VideoQuality.LOW))
    const onSubscribed = (_track: unknown, pub: RemoteTrackPublication) => set(VideoQuality.LOW)(pub)
    room.on(RoomEvent.TrackSubscribed, onSubscribed)
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed)
      each(set(VideoQuality.HIGH))
    }
  }, [room, cap])
}
