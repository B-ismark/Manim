import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useRoomInfo,
} from '@livekit/components-react'
import type { Participant } from 'livekit-client'
import { useAppStore } from '@/store/useAppStore'
import { setRoomFlags } from '@/lib/orchestrator'
import { sounds } from '@/lib/sounds'
import { toast } from '@/store/useToastStore'

/** Control-plane signalling topic (end / merge / handoff / report). */
export const CONTROL_TOPIC = 'mn.control'

type ControlMessage =
  | { type: 'end' }
  | { type: 'merge'; room: string }
  | { type: 'handoff'; userId: string; keepDevice: string }
  | { type: 'report'; target: string; by: string }

function userIdOf(p: Participant): string {
  try {
    return JSON.parse(p.metadata || '{}').userId || ''
  } catch {
    return ''
  }
}

/**
 * Session control plane over the LiveKit data channel:
 * - end: host ends the call for everyone
 * - merge: everyone moves into another room (host-initiated; the ringing trigger
 *   for "incoming call → merge" arrives with presence in M4)
 * - handoff: multi-device — switching to this device drops your other sessions
 *   (joining a second device without switching keeps both, which already works)
 */
export function useSessionControl(onLeave: () => void) {
  const room = useRoomContext()
  const navigate = useNavigate()
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()
  const { metadata: roomMetadata } = useRoomInfo()
  const deviceId = useAppStore((s) => s.deviceId)

  const isHost = useMemo(() => {
    try {
      return Boolean(JSON.parse(localParticipant.metadata || '{}').host)
    } catch {
      return false
    }
  }, [localParticipant.metadata])

  const { locked, waiting } = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      return { locked: Boolean(f.locked), waiting: Boolean(f.waiting) }
    } catch {
      return { locked: false, waiting: false }
    }
  }, [roomMetadata])

  const myUserId = userIdOf(localParticipant)

  // The same signed-in user is present on another device (guests are device-bound,
  // so this only fires for a real shared account).
  const sameNameOther = useMemo(
    () => Boolean(myUserId) && participants.some((p) => !p.isLocal && userIdOf(p) === myUserId),
    [participants, myUserId],
  )

  const doLeave = useCallback(async () => {
    try {
      await room.disconnect()
    } catch {
      /* already disconnected */
    }
    onLeave()
  }, [room, onLeave])

  const { send } = useDataChannel(CONTROL_TOPIC, (msg) => {
    let data: ControlMessage
    try {
      data = JSON.parse(new TextDecoder().decode(msg.payload))
    } catch {
      return
    }
    if (data.type === 'end') {
      sounds.end()
      void doLeave()
    } else if (data.type === 'merge' && data.room) {
      navigate(`/r/${encodeURIComponent(data.room)}`, { state: { autojoin: true } })
    } else if (data.type === 'handoff' && data.userId === myUserId && data.keepDevice !== deviceId) {
      void doLeave()
    } else if (data.type === 'report' && isHost) {
      // Only the host is notified of a report.
      toast(`${data.by} reported ${data.target}`, 'danger')
    }
  })

  const broadcast = useCallback(
    (msg: ControlMessage) =>
      send(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true, topic: CONTROL_TOPIC }),
    [send],
  )

  const endForEveryone = useCallback(async () => {
    try {
      await broadcast({ type: 'end' })
    } catch {
      /* best effort */
    }
    await doLeave()
  }, [broadcast, doLeave])

  /** Host: move everyone (including self) into `targetRoom`. */
  const mergeInto = useCallback(
    async (targetRoom: string) => {
      const slug = targetRoom.trim().toLowerCase().replace(/\s+/g, '-')
      if (!slug) return
      try {
        await broadcast({ type: 'merge', room: slug })
      } catch {
        /* best effort */
      }
      navigate(`/r/${encodeURIComponent(slug)}`, { state: { autojoin: true } })
    },
    [broadcast, navigate],
  )

  /** Multi-device: keep this device, drop my other sessions in this room. */
  const switchToThisDevice = useCallback(async () => {
    try {
      await broadcast({ type: 'handoff', userId: myUserId, keepDevice: deviceId })
    } catch {
      /* best effort */
    }
  }, [broadcast, myUserId, deviceId])

  /** Host: lock/unlock the room (blocks new joins). */
  const toggleLock = useCallback(async () => {
    try {
      await setRoomFlags({ room: room.name, caller: localParticipant.identity, locked: !locked })
    } catch {
      /* surfaced via thrown error elsewhere */
    }
  }, [room.name, localParticipant.identity, locked])

  /** Host: turn the waiting room on/off (new joins must be admitted). */
  const toggleWaiting = useCallback(async () => {
    try {
      await setRoomFlags({ room: room.name, caller: localParticipant.identity, waiting: !waiting })
    } catch {
      /* surfaced via thrown error elsewhere */
    }
  }, [room.name, localParticipant.identity, waiting])

  return {
    isHost,
    locked,
    waiting,
    doLeave,
    endForEveryone,
    mergeInto,
    toggleLock,
    toggleWaiting,
    sameNameOther,
    switchToThisDevice,
  }
}

export type SessionControl = ReturnType<typeof useSessionControl>
