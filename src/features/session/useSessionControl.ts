import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent } from 'livekit-client'
import { useNavigate } from 'react-router-dom'
import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useRoomInfo,
} from '@livekit/components-react'
import { roomDeviceId } from '@/lib/roomDevice'
import { useDataTopic } from '@/lib/useDataTopic'
import { useAppStore } from '@/store/useAppStore'
import { electHost, endRoom, handoff, setRoomFlags } from '@/lib/orchestrator'
import { roomTo, type RoomSecrets } from '@/lib/roomLink'
import { prettyRoom } from '@/lib/roomName'
import { markEnd } from '@/lib/callEnd'
import { userIdOf } from '@/lib/identity'
import { displayNameOf } from '@/lib/participantName'
import { sounds } from '@/lib/sounds'
import { toast } from '@/store/useToastStore'
import { reportError } from '@/lib/report'

/** How long the host may be gone before someone else is made host. */
const HOST_GRACE_MS = 45_000

/** Control-plane signalling topic (end / merge / handoff / report). */
export const CONTROL_TOPIC = 'mn.control'

type ControlMessage =
  | { type: 'end' }
  | { type: 'merge'; room: string; k?: string; e?: string }
  | { type: 'report'; target: string; by: string }
  /** Server-sent (handoff): this device's session is being moved elsewhere. */
  | { type: 'moved' }

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
/**
 * `encryptedHere` — this client's end-to-end encryption is actually on (RoomView's
 * e2eeActive, not merely "a key was in the link").
 */
export function useSessionControl(onLeave: () => void, encryptedHere = false) {
  const room = useRoomContext()
  const navigate = useNavigate()
  const { localParticipant } = useLocalParticipant()
  // Identities and account ids (metadata) only; not every speaking change.
  const participants = useParticipants({ updateOnlyOn: [RoomEvent.ParticipantMetadataChanged] })
  const { metadata: roomMetadata } = useRoomInfo()
  const deviceId = useAppStore((s) => s.deviceId)
  const roomToken = useAppStore((s) => s.roomToken)

  // Authority comes from ROOM metadata (server-written), never participant
  // metadata — participants can rewrite their own metadata (canUpdateOwnMetadata,
  // needed for raise-hand) and would otherwise self-promote to host.
  const { hostId, locked, waiting, chatHistory, coHosts, markedEncrypted } = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      return {
        hostId: f.hostId || '',
        locked: Boolean(f.locked),
        waiting: Boolean(f.waiting),
        chatHistory: f.chatHistory !== false,
        coHosts: Array.isArray(f.coHosts) ? (f.coHosts as string[]) : [],
        markedEncrypted: f.encrypted === true,
      }
    } catch {
      return {
        hostId: '',
        locked: false,
        waiting: false,
        chatHistory: true,
        coHosts: [] as string[],
        markedEncrypted: false,
      }
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
    if (nowCo && !wasCoHost.current && !isPrimaryHost) toast("You’re now a co-host", 'neutral')
    wasCoHost.current = nowCo
  }, [coHosts, localParticipant.identity, isPrimaryHost])

  // Host succession (#15). When the recorded host is no longer in the live roster,
  // trigger a server-side election so the seat doesn't point at a ghost and the
  // co-host roster stops being frozen. The server picks the successor
  // deterministically, so several clients calling at once is safe — but only the
  // likely successor calls first (below), and "host left" is announced just once.
  //
  // After a grace period, not at once: a host whose connection drops for a few
  // seconds (a train tunnel, wifi → cellular, a reload) comes back with a new
  // session, and electing immediately handed their room to someone else for good.
  // If they're back within the grace, nothing happens and nobody is told.
  const hostPresent = Boolean(hostId) && participants.some((p) => p.identity === hostId)
  const elected = useRef(false)
  const announcedHostLeft = useRef(false)
  const [graceOver, setGraceOver] = useState(false)
  const [electTry, setElectTry] = useState(0)
  useEffect(() => {
    // Every change of the recorded host starts over — including one absent host
    // replaced by another, which must get its own grace and its own election.
    elected.current = false
    setGraceOver(false)
    if (!hostId || hostPresent) {
      announcedHostLeft.current = false
      return
    }
    const t = setTimeout(() => setGraceOver(true), HOST_GRACE_MS)
    return () => clearTimeout(t)
  }, [hostPresent, hostId])
  useEffect(() => {
    if (!graceOver || !hostId || hostPresent) return
    if (!announcedHostLeft.current) {
      announcedHostLeft.current = true
      toast('The host left the call', 'neutral')
    }
    if (elected.current || !roomToken) return
    // Only the likely successor asks straight away (the server's own pick: the
    // longest-present co-host, else the longest-present person). Everyone else
    // waits, and asks only if the seat is STILL empty — a new hostId re-runs this
    // effect and cancels them. It used to be one request from every person.
    const present = participants.filter((p) => coHosts.includes(p.identity))
    const pool = present.length ? present : participants
    const tenure = (p: (typeof participants)[number]) => p.joinedAt?.getTime() ?? Infinity
    const first = [...pool].sort((a, b) => tenure(a) - tenure(b) || a.identity.localeCompare(b.identity))[0]
    const wait = first?.identity === localParticipant.identity ? 0 : 15_000
    let retry: ReturnType<typeof setTimeout> | undefined
    const ask = setTimeout(() => {
      elected.current = true
      void electHost(room.name, roomToken).catch(() => {
        // Nothing else re-runs this effect, so schedule the retry ourselves.
        elected.current = false
        retry = setTimeout(() => setElectTry((n) => n + 1), 10_000)
      })
    }, wait)
    return () => {
      clearTimeout(ask)
      clearTimeout(retry)
    }
    // participants/coHosts only decide who goes first; re-running on every roster
    // change would restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graceOver, hostPresent, hostId, roomToken, room.name, electTry])

  // "You're now the host" once you inherit the primary seat (skip the initial
  // value so the original host isn't toasted at join).
  const wasPrimary = useRef(isPrimaryHost)
  useEffect(() => {
    if (isPrimaryHost && !wasPrimary.current) toast("You’re now the host", 'neutral')
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

  const { send } = useDataTopic(CONTROL_TOPIC, (msg) => {
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
      markEnd('ended')
      void doLeave()
    } else if (data.type === 'merge' && data.room) {
      if (senderId !== hostId) return // only the host can move everyone
      // Orientation beat: the merge auto-joins the new room and re-publishes mic/cam,
      // which is jarring with no warning. Announce the move (the toast lingers across
      // the navigation) so the participant knows why their call just changed rooms.
      toast(`The host moved everyone to ${prettyRoom(data.room)}`, 'neutral')
      // Carry the target room's secrets so everyone passes its join-secret gate.
      navigate(roomTo(data.room, { secret: data.k, e2ee: data.e }), { state: { autojoin: true } })
    } else if (data.type === 'moved' && !msg.from) {
      // Only the server can send this (no participant has an empty identity); the
      // removal that follows would otherwise read as "the host removed you".
      markEnd('moved')
    } else if (data.type === 'report' && isHost && msg.from) {
      // Only the host is notified of a report. Named from the SENDER, not the
      // payload's `by`, which anyone could fill with someone else's name.
      toast(`${displayNameOf(msg.from.identity, msg.from.name)} reported ${data.target}`, 'danger')
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
    markEnd('endedByYou')
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
      await handoff(room.name, roomToken, await roomDeviceId(deviceId, room.name))
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
      toast('Couldn’t change the call lock — try again', 'danger')
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

  // Tell the server this call is encrypted — only THAT it is, never the key — so
  // someone who arrives without the key (emailed invites leave it out) is told at
  // the door to ask for the full link, instead of joining a call they can't see or
  // hear while their own camera goes out unencrypted (server/core.mjs need_key).
  // Only once our encryption is really on: a failed enable must not lock out
  // guests from a call that isn't encrypted after all. Retried a few times until the
  // mark shows up in room metadata: a failed request, or a knock's flag write that
  // lands on top of ours, would otherwise leave the room unmarked for good.
  const [markTry, setMarkTry] = useState(0)
  // A fresh budget whenever the conditions change (host handed over, token renewed),
  // so spent attempts under the old ones can't leave the room unmarked for good.
  useEffect(() => setMarkTry(0), [isHost, roomToken])
  useEffect(() => {
    if (!encryptedHere || !isHost || markedEncrypted || !roomToken || markTry > 3) return
    void setRoomFlags({ room: room.name, token: roomToken, encrypted: true }).catch((e) =>
      reportError(e, { context: 'mark-encrypted' }),
    )
    const t = setTimeout(() => setMarkTry((n) => n + 1), 15_000)
    return () => clearTimeout(t)
  }, [encryptedHere, isHost, markedEncrypted, roomToken, room.name, markTry])

  /** Host: whether people who join later see earlier chat (default on). */
  const toggleChatHistory = useCallback(async () => {
    if (!roomToken) return
    try {
      await setRoomFlags({ room: room.name, token: roomToken, chatHistory: !chatHistory })
      toast(
        chatHistory
          ? 'People who join from now on won’t see earlier messages'
          : 'People who join later will see earlier messages',
        'neutral',
      )
    } catch (e) {
      reportError(e, { context: 'toggle-chat-history' })
      toast('Couldn’t change chat history — try again', 'danger')
    }
  }, [room.name, roomToken, chatHistory])

  return {
    isHost,
    isPrimaryHost,
    coHosts,
    setCoHost,
    locked,
    waiting,
    chatHistory,
    toggleChatHistory,
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
