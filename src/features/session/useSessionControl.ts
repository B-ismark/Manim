import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useRoomInfo,
} from '@livekit/components-react'
import { useAppStore } from '@/store/useAppStore'
import { electHost, endRoom, handoff, setRoomFlags } from '@/lib/orchestrator'
import { roomTo, type RoomSecrets } from '@/lib/roomLink'
import { userIdOf } from '@/lib/identity'
import { sounds } from '@/lib/sounds'
import { toast } from '@/store/useToastStore'
import { reportError } from '@/lib/report'

/** Control-plane signalling topic (end / merge / handoff / report). */
export const CONTROL_TOPIC = 'mn.control'

type ControlMessage =
  | { type: 'end' }
  | { type: 'merge'; room: string; k?: string; e?: string }
  | { type: 'report'; target: string; by: string }

/**
 * Session control plane over the LiveKit data channel:
 * - end: host ends the call for everyone
 * - merge: everyone moves into another room (host-initiated; the ringing trigger
 *   for "incoming call → merge" arrives with presence in M4)
 * Handoff (multi-device — switching to this device drops your other sessions) is
 * NOT here: it's a server-mediated call (orchestrator.handoff) authorized on the
 * caller's signed-token account id, because a data-channel broadcast can be forged
 * to disconnect another participant. Joining a second device without switching
 * keeps both, which already works.
 */
export function useSessionControl(onLeave: () => void) {
  const room = useRoomContext()
  const navigate = useNavigate()
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()
  const { metadata: roomMetadata } = useRoomInfo()
  const deviceId = useAppStore((s) => s.deviceId)
  const roomToken = useAppStore((s) => s.roomToken)

  // Authority comes from ROOM metadata (server-written), never participant
  // metadata — participants can rewrite their own metadata (canUpdateOwnMetadata,
  // needed for raise-hand) and would otherwise self-promote to host.
  const { hostId, locked, waiting, coHosts } = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      return {
        hostId: f.hostId || '',
        locked: Boolean(f.locked),
        waiting: Boolean(f.waiting),
        coHosts: Array.isArray(f.coHosts) ? (f.coHosts as string[]) : [],
      }
    } catch {
      return { hostId: '', locked: false, waiting: false, coHosts: [] as string[] }
    }
  }, [roomMetadata])

  // Primary host = the one who can promote/demote co-hosts. isHost grants the
  // moderation UI to the primary host AND any co-host (server re-checks both).
  const isPrimaryHost = Boolean(hostId) && localParticipant.identity === hostId
  const isHost = isPrimaryHost || coHosts.includes(localParticipant.identity)

  // Tell a participant the moment they're promoted (their identity enters coHosts).
  const wasCoHost = useRef(false)
  useEffect(() => {
    const nowCo = coHosts.includes(localParticipant.identity)
    if (nowCo && !wasCoHost.current && !isPrimaryHost) toast("You're now a co-host", 'neutral')
    wasCoHost.current = nowCo
  }, [coHosts, localParticipant.identity, isPrimaryHost])

  // Host succession (#15). When the recorded host is no longer in the live roster
  // (they left for good), trigger a server-side election so the seat doesn't point
  // at a ghost and the co-host roster stops being frozen. The server picks the
  // successor deterministically, so every client calling at once is safe — but we
  // still guard to one call per absence and announce "host left" just once.
  const hostPresent = Boolean(hostId) && participants.some((p) => p.identity === hostId)
  const elected = useRef(false)
  const announcedHostLeft = useRef(false)
  useEffect(() => {
    if (!hostId || hostPresent) {
      elected.current = false
      announcedHostLeft.current = false
      return
    }
    if (!announcedHostLeft.current) {
      announcedHostLeft.current = true
      toast('The host left the call', 'neutral')
    }
    if (!elected.current && roomToken) {
      elected.current = true
      void electHost(room.name, roomToken).catch(() => {
        elected.current = false // let a later render retry if it failed
      })
    }
  }, [hostPresent, hostId, roomToken, room.name])

  // "You're now the host" once you inherit the primary seat (skip the initial
  // value so the original host isn't toasted at join).
  const wasPrimary = useRef(isPrimaryHost)
  useEffect(() => {
    if (isPrimaryHost && !wasPrimary.current) toast("You're now the host", 'neutral')
    wasPrimary.current = isPrimaryHost
  }, [isPrimaryHost])

  /** Primary host: add/remove a participant identity from the co-host roster. */
  const setCoHost = useCallback(
    async (identity: string, on: boolean) => {
      if (!roomToken || !isPrimaryHost) return
      const next = on ? [...coHosts, identity] : coHosts.filter((id) => id !== identity)
      try {
        await setRoomFlags({ room: room.name, token: roomToken, coHosts: next })
      } catch (e) {
        // The flag write failed: room metadata never changes, so the co-host roster
        // silently stays as-is. Tell the host their action didn't take (E2 — the old
        // "surfaced elsewhere" comment was wrong; nothing rethrew this) and report it.
        reportError(e, { context: 'set-cohost' })
        toast('Couldn’t update co-hosts — try again', 'danger')
      }
    },
    [roomToken, isPrimaryHost, coHosts, room.name],
  )

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
    // The sender's identity is from their signed token (unforgeable); the host's
    // identity is the server-written hostId. Authorize destructive actions
    // against that, so a malicious participant can't end/redirect the call.
    const senderId = msg.from?.identity ?? ''

    if (data.type === 'end') {
      if (senderId !== hostId) return // only the room host can end for everyone
      sounds.end()
      void doLeave()
    } else if (data.type === 'merge' && data.room) {
      if (senderId !== hostId) return // only the host can move everyone
      // Orientation beat: the merge auto-joins the new room and re-publishes mic/cam,
      // which is jarring with no warning. Announce the move (the toast lingers across
      // the navigation) so the participant knows why their call just changed rooms.
      toast(`The host moved everyone to ${data.room}`, 'neutral')
      // Carry the target room's secrets so everyone passes its join-secret gate.
      navigate(roomTo(data.room, { secret: data.k, e2ee: data.e }), { state: { autojoin: true } })
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
    // Instant teardown for everyone currently connected (data channel)…
    try {
      await broadcast({ type: 'end' })
    } catch {
      /* best effort */
    }
    // …plus the authoritative server-side close: deletes the room so anyone
    // mid-reconnect (who'd miss the broadcast) is disconnected and can't rejoin.
    // Without this the host leaves and a reconnecting participant is stranded
    // alone in a call that "ended" for everyone else.
    if (roomToken) {
      try {
        await endRoom(room.name, roomToken)
      } catch {
        /* best effort — the broadcast already handled the live participants */
      }
    }
    await doLeave()
  }, [broadcast, doLeave, room.name, roomToken])

  /** Host: move everyone (including self) into `targetRoom`, carrying that room's
   *  invite secrets so all participants pass its join-secret gate. */
  const mergeInto = useCallback(
    async (targetRoom: string, secrets: RoomSecrets = {}) => {
      const slug = targetRoom.trim().toLowerCase().replace(/\s+/g, '-')
      if (!slug) return
      try {
        await broadcast({ type: 'merge', room: slug, k: secrets.secret, e: secrets.e2ee })
      } catch {
        /* best effort */
      }
      navigate(roomTo(slug, secrets), { state: { autojoin: true } })
    },
    [broadcast, navigate],
  )

  /** Multi-device: keep this device, drop my other sessions in this room. Routed
   *  through the server (authorized on the signed-token account id) so it can't be
   *  forged to disconnect another participant. */
  const switchToThisDevice = useCallback(async () => {
    if (!roomToken) return
    try {
      await handoff(room.name, roomToken, deviceId)
    } catch {
      /* best effort */
    }
  }, [roomToken, room.name, deviceId])

  /** Host: lock/unlock the room (blocks new joins). */
  const toggleLock = useCallback(async () => {
    if (!roomToken) return
    try {
      await setRoomFlags({ room: room.name, token: roomToken, locked: !locked })
    } catch (e) {
      // Lock state lives in server-written room metadata, so on failure the UI
      // simply never flips — with no feedback. Surface + report it (E2).
      reportError(e, { context: 'toggle-lock' })
      toast('Couldn’t change the room lock — try again', 'danger')
    }
  }, [room.name, roomToken, locked])

  /** Host: turn the waiting room on/off (new joins must be admitted). */
  const toggleWaiting = useCallback(async () => {
    if (!roomToken) return
    try {
      await setRoomFlags({ room: room.name, token: roomToken, waiting: !waiting })
    } catch (e) {
      // Same as toggleLock: the waiting-room flag is server-written metadata, so a
      // failed write leaves the toggle silently reverted. Surface + report it (E2).
      reportError(e, { context: 'toggle-waiting' })
      toast('Couldn’t change the waiting room — try again', 'danger')
    }
  }, [room.name, roomToken, waiting])

  return {
    isHost,
    isPrimaryHost,
    coHosts,
    setCoHost,
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
