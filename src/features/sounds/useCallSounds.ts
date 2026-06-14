import { useEffect, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import type { Participant } from 'livekit-client'
import { sounds } from '@/lib/sounds'
import { HAND_ATTR } from '@/features/reactions/useReactions'

/**
 * Plays contextual cues for participant lifecycle + raised hands by listening to
 * room events. Reaction and end-call cues are fired where those events already
 * live (useReactions / useSessionControl). Mounted once inside the room.
 */
export function useCallSounds() {
  const room = useRoomContext()
  // Skip the burst of "join" cues fired as we first sync the existing roster.
  const settled = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      settled.current = true
    }, 1500)

    const onConnected = () => {
      if (settled.current) sounds.join()
    }
    const onDisconnected = () => {
      if (settled.current) sounds.leave()
    }
    const onAttr = (changed: Record<string, string>, p: Participant) => {
      if (!p.isLocal && changed[HAND_ATTR] === '1') sounds.hand()
    }

    room.on(RoomEvent.ParticipantConnected, onConnected)
    room.on(RoomEvent.ParticipantDisconnected, onDisconnected)
    room.on(RoomEvent.ParticipantAttributesChanged, onAttr)
    return () => {
      window.clearTimeout(t)
      room.off(RoomEvent.ParticipantConnected, onConnected)
      room.off(RoomEvent.ParticipantDisconnected, onDisconnected)
      room.off(RoomEvent.ParticipantAttributesChanged, onAttr)
    }
  }, [room])
}
