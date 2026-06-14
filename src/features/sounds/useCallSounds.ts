import { useEffect, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import type { Participant } from 'livekit-client'
import { sounds } from '@/lib/sounds'
import { toast } from '@/store/useToastStore'
import { HAND_ATTR } from '@/features/reactions/useReactions'

function nameOf(p: Participant): string {
  return p.name || p.identity.split('#')[0] || 'Someone'
}

/**
 * Plays contextual cues + on-screen toasts for participant lifecycle and raised
 * hands by listening to room events. Reaction and end-call cues are fired where
 * those events already live (useReactions / useSessionControl). Mounted once
 * inside the room.
 */
export function useCallSounds() {
  const room = useRoomContext()
  // Skip the burst of "join" cues fired as we first sync the existing roster.
  const settled = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      settled.current = true
    }, 1500)

    const onConnected = (p: Participant) => {
      if (!settled.current) return
      sounds.join()
      toast(`${nameOf(p)} joined`, 'info')
    }
    const onDisconnected = (p: Participant) => {
      if (!settled.current) return
      sounds.leave()
      toast(`${nameOf(p)} left`, 'neutral')
    }
    const onAttr = (changed: Record<string, string>, p: Participant) => {
      if (!p.isLocal && changed[HAND_ATTR] === '1') {
        sounds.hand()
        toast(`${nameOf(p)} raised their hand`, 'warning')
      }
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
