import { useEffect } from 'react'
import { RoomEvent, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client'
import { useRoomContext } from '@livekit/components-react'
import { useBlockStore } from '@/store/useBlockStore'

/**
 * Enforces local blocks for this client: a blocked participant's tracks are
 * UNSUBSCRIBED, not just hidden and silenced (tiles are filtered separately in the
 * Stage). Mounted once in the room.
 *
 * It used to set their volume to 0 and leave the subscription alone, so the SFU
 * kept sending their audio and video and this browser kept receiving and decoding
 * it — bandwidth and CPU spent on a person you'd asked not to see or hear. An
 * unsubscribe stops it at the SFU.
 *
 * The room auto-subscribes, so a track a blocked person publishes later (a camera
 * turned on, a share) arrives subscribed; it's dropped as it lands. Unblocking
 * subscribes their tracks again.
 */
export function useApplyBlocks() {
  const room = useRoomContext()
  const blocked = useBlockStore((s) => s.blocked)

  useEffect(() => {
    const apply = (p: RemoteParticipant) => {
      const on = !blocked.includes(p.identity)
      for (const pub of p.trackPublications.values()) {
        if (pub.isDesired !== on) pub.setSubscribed(on)
      }
    }
    for (const p of room.remoteParticipants.values()) apply(p)

    const drop = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (blocked.includes(p.identity)) pub.setSubscribed(false)
    }
    const onSubscribed = (_t: unknown, pub: RemoteTrackPublication, p: RemoteParticipant) => drop(pub, p)
    room.on(RoomEvent.TrackPublished, drop)
    room.on(RoomEvent.TrackSubscribed, onSubscribed)
    return () => {
      room.off(RoomEvent.TrackPublished, drop)
      room.off(RoomEvent.TrackSubscribed, onSubscribed)
    }
  }, [room, blocked])
}
