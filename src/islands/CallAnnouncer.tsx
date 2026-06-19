import { useEffect, useRef } from 'react'
import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react'
import { ConnectionState, RoomEvent, Track, type Participant } from 'livekit-client'
import { HAND_ATTR } from '@/features/reactions/useReactions'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'

function nameOf(p: Participant): string {
  return p.name || p.identity.split('#')[0] || 'Someone'
}

/**
 * Voices call state for screen readers (WCAG 4.1.3 Status Messages) via the
 * shared announcer (AnnouncerProvider renders the live regions; this component
 * renders nothing). No behavioural effect for sighted users. State that MUST
 * interrupt — being force-muted by a host, losing/regaining the connection — is
 * announced assertively; the rest politely.
 *
 * Mount once inside the room (RoomView) where the LiveKit room context exists.
 */
export function CallAnnouncer() {
  const room = useRoomContext()
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant()
  const connection = useConnectionState()
  const announce = useAnnounce()

  // ── Joins / leaves ─────────────────────────────────────────────────────────
  // Keep the previous Participant objects (not just ids) so we can name who LEFT,
  // and announce joins AND leaves in the same tick instead of dropping one.
  const prev = useRef<Map<string, Participant> | null>(null)
  useEffect(() => {
    const now = new Map(participants.map((p) => [p.identity, p]))
    const before = prev.current
    prev.current = now
    if (!before) return // skip the initial roster

    const joined = participants.filter((p) => !before.has(p.identity))
    const left = [...before.values()].filter((p) => !now.has(p.identity))

    if (joined.length === 1) announce(`${nameOf(joined[0])} joined the call`)
    else if (joined.length > 1) announce(`${joined.length} people joined`)

    if (left.length === 1) announce(`${nameOf(left[0])} left the call`)
    else if (left.length > 1) announce(`${left.length} people left`)
  }, [participants, announce])

  // ── Local mic ───────────────────────────────────────────────────────────────
  // First effect run is the initial state, not a change — don't announce it.
  const firstMic = useRef(true)
  useEffect(() => {
    if (firstMic.current) {
      firstMic.current = false
      return
    }
    announce(isMicrophoneEnabled ? 'Microphone on' : 'Microphone muted')
  }, [isMicrophoneEnabled, announce])

  // ── Host force-mute (assertive) ──────────────────────────────────────────────
  // A moderator muting you fires a server-side TrackMuted on YOUR mic publication
  // that you didn't initiate. This is the message a non-sighted user most needs:
  // otherwise they keep talking into a dead mic. Announced assertively so it
  // interrupts. (Self-mute is already covered above; we only flag the remote one.)
  useEffect(() => {
    if (!room) return
    const onMuted = (pub: { source?: Track.Source }, p: Participant) => {
      if (p.identity !== localParticipant.identity) return
      if (pub.source === Track.Source.Microphone) {
        announce('You were muted by the host', 'assertive')
      } else if (pub.source === Track.Source.Camera) {
        announce('Your camera was turned off by the host', 'assertive')
      }
    }
    room.on(RoomEvent.TrackMuted, onMuted)
    return () => {
      room.off(RoomEvent.TrackMuted, onMuted)
    }
  }, [room, localParticipant, announce])

  // ── Screen share start/stop (any participant) ────────────────────────────────
  const prevSharers = useRef<Set<string> | null>(null)
  useEffect(() => {
    const sharing = new Set(
      participants
        .filter((p) =>
          [...p.trackPublications.values()].some(
            (pub) => pub.source === Track.Source.ScreenShare && !pub.isMuted,
          ),
        )
        .map((p) => p.identity),
    )
    const before = prevSharers.current
    prevSharers.current = sharing
    if (!before) return

    for (const id of sharing) {
      if (!before.has(id)) {
        const p = participants.find((x) => x.identity === id)
        const who = p?.identity === localParticipant.identity ? 'You' : p ? nameOf(p) : 'Someone'
        announce(`${who} started sharing their screen`)
      }
    }
    for (const id of before) {
      if (!sharing.has(id)) announce('Screen sharing stopped')
    }
  }, [participants, localParticipant, announce])

  // We read isScreenShareEnabled only to keep the local share state subscribed/
  // fresh; the per-participant scan above is the source of truth for the message.
  void isScreenShareEnabled

  // ── Connection drop / restore (assertive) ─────────────────────────────────────
  const wasConnected = useRef(connection === ConnectionState.Connected)
  useEffect(() => {
    const reconnecting =
      connection === ConnectionState.Reconnecting ||
      connection === ConnectionState.SignalReconnecting
    if (reconnecting && wasConnected.current) {
      wasConnected.current = false
      announce('Connection lost. Reconnecting…', 'assertive')
    } else if (connection === ConnectionState.Connected && !wasConnected.current) {
      wasConnected.current = true
      announce('Reconnected', 'assertive')
    }
  }, [connection, announce])

  // ── Raised hands ──────────────────────────────────────────────────────────────
  const raisedKey = participants
    .filter((p) => p.attributes?.[HAND_ATTR] === '1')
    .map((p) => p.identity)
    .sort()
    .join('|')
  const prevRaised = useRef<Set<string> | null>(null)
  useEffect(() => {
    const raised = new Set(raisedKey ? raisedKey.split('|') : [])
    const before = prevRaised.current
    prevRaised.current = raised
    if (!before) return
    const newly = participants.filter((p) => raised.has(p.identity) && !before.has(p.identity))
    if (newly.length === 1) announce(`${nameOf(newly[0])} raised their hand`)
    else if (newly.length > 1) announce(`${newly.length} people raised their hands`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raisedKey])

  // The live regions are rendered by AnnouncerProvider; this component is effects-only.
  return null
}
