import { useMemo, useState, type FormEvent } from 'react'
import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useRoomInfo,
  useIsSpeaking,
  useIsMuted,
} from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { Participant } from 'livekit-client'
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
  IconButton,
} from '@/components/primitives'
import {
  BanIcon,
  CameraOffIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  CrownIcon,
  FlagIcon,
  HandIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  PinIcon,
} from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { useHandRaised } from '@/features/reactions/useReactions'
import { CONTROL_TOPIC } from '@/features/session/useSessionControl'
import { useRoomStore } from '@/store/useRoomStore'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useBlockStore } from '@/store/useBlockStore'
import { useInviteStore } from '@/store/useInviteStore'
import { toast } from '@/store/useToastStore'
import { useCopyLink } from '@/lib/useCopyLink'
import { isMyOtherDevice, useMyUserId } from '@/lib/identity'
import { moderate, sendEmailInvite, setRoomFlags } from '@/lib/orchestrator'
import { ringUser } from '@/features/calls/calls'
import { authEnabled } from '@/lib/supabase'
import { cn } from '@/lib/cn'

function displayName(p: Participant): string {
  return p.name || p.identity.split('#')[0] || 'Guest'
}

/** Roster with live state (speaking / mic / hand / connection) and per-row actions. */
export function ParticipantsPanel() {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const myUserId = useMyUserId()
  const room = useRoomContext()
  const { copied, copy } = useCopyLink()
  const [email, setEmail] = useState('')
  const [callMsg, setCallMsg] = useState<string | null>(null)
  // Set when the server couldn't send (not configured, or provider rejected the
  // recipient). We render a real mailto link the user can click — a programmatic
  // window.open after an await is killed by popup blockers, so a click is the
  // only reliable fallback.
  const [mailto, setMailto] = useState<{ href: string; to: string } | null>(null)
  const signedIn = useAuthStore((s) => s.signedIn)
  const canRing = authEnabled && signedIn
  const roomToken = useAppStore((s) => s.roomToken)
  const { metadata: roomMetadata } = useRoomInfo()
  const pendingInvites = useInviteStore((s) => s.pending)
  const addInvite = useInviteStore((s) => s.addInvite)
  const clearInvite = useInviteStore((s) => s.clearInvite)

  // Ghost "Invited · waiting" rows: drop ones older than 3 min or whose label
  // matches a present participant (they joined). Client/device-local hint only.
  const ghostInvites = useMemo(() => {
    const now = Date.now()
    const present = new Set(participants.map((p) => displayName(p).toLowerCase()))
    return pendingInvites.filter(
      (inv) => now - inv.ts < 3 * 60_000 && !present.has(inv.label.toLowerCase()),
    )
  }, [pendingInvites, participants])

  // Host authority is the server-written room hostId / coHosts (not forgeable
  // participant metadata). UI only — the server re-checks every privileged call.
  const { isPrimaryHost, coHosts } = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      return {
        isPrimaryHost: f.hostId === localParticipant.identity,
        coHosts: Array.isArray(f.coHosts) ? (f.coHosts as string[]) : [],
      }
    } catch {
      return { isPrimaryHost: false, coHosts: [] as string[] }
    }
  }, [roomMetadata, localParticipant.identity])
  // Co-hosts get the moderation UI too; only the primary host manages the roster.
  const isHost = isPrimaryHost || coHosts.includes(localParticipant.identity)

  async function toggleCoHost(identity: string, on: boolean) {
    if (!roomToken || !isPrimaryHost) return
    const next = on ? [...coHosts, identity] : coHosts.filter((id) => id !== identity)
    try {
      await setRoomFlags({ room: room.name, token: roomToken, coHosts: next })
    } catch {
      /* surfaced via thrown error elsewhere */
    }
  }

  function mailtoHref(to: string): string {
    const subject = encodeURIComponent("You're invited to a Manim call")
    const body = encodeURIComponent(`Join my call:\n\n${window.location.href}`)
    return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
  }

  /** Fall back to the user's mail client: best-effort auto-open + a click target. */
  function fallbackToMailto(to: string) {
    const href = mailtoHref(to)
    setMailto({ href, to })
    setCallMsg(null)
    addInvite(to)
    window.open(href, '_blank') // best effort; popup blockers may ignore it
  }

  async function emailInvite(e: FormEvent) {
    e.preventDefault()
    const to = email.trim()
    if (!to) return
    setMailto(null)
    const who = localParticipant.name || 'Someone'
    try {
      // Try a real email first; fall back to the mail client if the server has
      // no provider configured or the provider rejects the recipient.
      const sent = await sendEmailInvite(to, room.name, window.location.href, who)
      if (sent) {
        setCallMsg(`Invite emailed to ${to}`)
        addInvite(to)
        setEmail('')
      } else {
        fallbackToMailto(to)
      }
    } catch {
      fallbackToMailto(to)
    }
  }

  async function ring() {
    if (!email.trim()) return
    setCallMsg('Ringing…')
    const err = await ringUser(email, room.name, localParticipant.name || 'Someone')
    setCallMsg(err ?? `Ringing ${email}…`)
    if (!err) {
      addInvite(email)
      setEmail('')
    }
  }

  // Report flags a participant to the host over the control channel (only the
  // host is notified). No central moderation backend — keeps it lightweight.
  async function reportUser(targetName: string) {
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'report', target: targetName, by: localParticipant.name || 'Someone' }),
    )
    try {
      await localParticipant.publishData(payload, { reliable: true, topic: CONTROL_TOPIC })
    } catch {
      /* best effort */
    }
    toast('Reported to the host', 'neutral')
  }

  // Host bulk actions — loop the existing per-track /api/moderate over everyone
  // but self. Client-only; the "let attendees unmute" permission lock is a
  // separate server change (deferred), so this mutes once, it doesn't lock.
  async function muteAll(source: Track.Source, kind: 'mic' | 'camera') {
    if (!roomToken) return
    const targets = participants.filter((p) => p.identity !== localParticipant.identity)
    await Promise.all(
      targets.map((p) => {
        const pub = p.getTrackPublication(source)
        if (!pub || pub.isMuted || !pub.trackSid) return undefined
        return moderate({
          room: room.name,
          token: roomToken,
          target: p.identity,
          action: 'mute',
          trackSid: pub.trackSid,
        }).catch(() => {})
      }),
    )
    toast(kind === 'mic' ? 'Muted everyone' : 'Stopped everyone’s video', 'neutral')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3">
        <Button variant="neutral" block onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Invite link copied' : 'Copy invite link'}
        </Button>

        <form onSubmit={emailInvite} className="mt-2 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Invite by email"
            aria-label="Invite by email"
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-field bg-sunken px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />
          {canRing && (
            <Button type="button" variant="neutral" size="sm" disabled={!email.trim()} onClick={ring}>
              Call
            </Button>
          )}
          <Button type="submit" variant="accent" size="sm" disabled={!email.trim()}>
            Invite
          </Button>
        </form>
        {callMsg && <p className="mt-1 text-xs text-ink-muted">{callMsg}</p>}
        {mailto && (
          <p className="mt-1 text-xs text-ink-muted">
            Couldn’t email automatically.{' '}
            <a
              href={mailto.href}
              className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
              onClick={() => {
                setMailto(null)
                setEmail('')
              }}
            >
              Open mail app to invite {mailto.to}
            </a>
          </p>
        )}

        <p className="mt-3 text-xs font-medium text-ink-subtle">{participants.length} in call</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {participants.map((p) => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            isLocal={p.identity === localParticipant.identity}
            myOtherDevice={isMyOtherDevice(p, myUserId)}
            canModerate={isHost && p.identity !== localParticipant.identity}
            canManageCoHost={isPrimaryHost && p.identity !== localParticipant.identity}
            isCoHost={coHosts.includes(p.identity)}
            onToggleCoHost={toggleCoHost}
            room={room.name}
            token={roomToken}
            onReport={reportUser}
          />
        ))}

        {ghostInvites.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center gap-3 rounded-field px-2 py-1.5 opacity-70"
          >
            <Avatar name={inv.label} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{inv.label}</p>
              <p className="text-xs text-ink-subtle">Invited · waiting</p>
            </div>
            <IconButton
              size="sm"
              tone="neutral"
              label={`Cancel invite to ${inv.label}`}
              icon={<CloseIcon />}
              onClick={() => clearInvite(inv.id)}
            />
          </li>
        ))}
      </ul>

      {isHost && participants.length > 1 && (
        <div className="flex gap-2 border-t border-line p-2">
          <Button variant="neutral" size="sm" block onClick={() => muteAll(Track.Source.Microphone, 'mic')}>
            <MicOffIcon /> Mute all
          </Button>
          <Button variant="neutral" size="sm" block onClick={() => muteAll(Track.Source.Camera, 'camera')}>
            <CameraOffIcon /> Stop video
          </Button>
        </div>
      )}
    </div>
  )
}

function ParticipantRow({
  participant,
  isLocal,
  myOtherDevice,
  canModerate,
  canManageCoHost,
  isCoHost,
  onToggleCoHost,
  room,
  token,
  onReport,
}: {
  participant: Participant
  isLocal: boolean
  myOtherDevice: boolean
  canModerate: boolean
  canManageCoHost: boolean
  isCoHost: boolean
  onToggleCoHost: (identity: string, on: boolean) => void
  room: string
  token: string | null
  onReport: (targetName: string) => void
}) {
  const speaking = useIsSpeaking(participant)
  const micRef = { participant, source: Track.Source.Microphone } as TrackReferenceOrPlaceholder
  const micMuted = useIsMuted(micRef)
  const handRaised = useHandRaised(participant)

  const pinned = useRoomStore((s) => s.pinned) === participant.identity
  const togglePin = useRoomStore((s) => s.togglePin)
  const blocked = useBlockStore((s) => s.blocked.includes(participant.identity))
  const toggleBlock = useBlockStore((s) => s.toggle)

  const name = displayName(participant)
  const camPub = participant.getTrackPublication(Track.Source.Camera)
  const hasCamera = Boolean(camPub && !camPub.isMuted)

  async function forceMute() {
    const trackSid = participant.getTrackPublication(Track.Source.Microphone)?.trackSid
    if (!trackSid || !token) return
    try {
      await moderate({ room, token, target: participant.identity, action: 'mute', trackSid })
    } catch {
      /* surfaced elsewhere; ignore here */
    }
  }

  async function disableVideo() {
    const trackSid = camPub?.trackSid
    if (!trackSid || !token) return
    try {
      await moderate({ room, token, target: participant.identity, action: 'mute', trackSid })
    } catch {
      /* ignore */
    }
  }

  async function remove() {
    if (!token) return
    try {
      await moderate({ room, token, target: participant.identity, action: 'remove' })
    } catch {
      /* ignore */
    }
  }

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-field px-2 py-1.5',
        speaking && 'bg-accent-soft',
      )}
    >
      <div className="relative">
        <Avatar name={name} size="sm" />
        {handRaised && (
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-warning text-warning-ink [&_svg]:size-2.5">
            <HandIcon />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {isLocal && <span className="text-ink-subtle"> (you)</span>}
          {myOtherDevice && <span className="text-ink-subtle"> (your device)</span>}
        </p>
        <div className="flex flex-wrap gap-1">
          {isCoHost && (
            <Badge tone="accent" className="mt-0.5">
              <CrownIcon className="size-3" /> Co-host
            </Badge>
          )}
          {pinned && (
            <Badge tone="accent" className="mt-0.5">
              <PinIcon className="size-3" /> Pinned
            </Badge>
          )}
        </div>
      </div>

      <span className="text-ink-muted [&_svg]:size-4" title={micMuted ? 'Muted' : 'Unmuted'}>
        {micMuted ? <MicOffIcon className="text-danger" /> : <MicIcon />}
      </span>

      <ConnectionQuality participant={participant} />

      <DropdownMenu
        trigger={<IconButton size="sm" tone="neutral" label={`Actions for ${name}`} icon={<MoreIcon />} />}
      >
        <DropdownItem icon={<PinIcon />} onSelect={() => togglePin(participant.identity)}>
          {pinned ? 'Unpin' : 'Pin'}
        </DropdownItem>

        {/* Personal, client-side moderation — available for any other participant. */}
        {!isLocal && (
          <>
            <DropdownItem icon={<BanIcon />} onSelect={() => toggleBlock(participant.identity)}>
              {blocked ? 'Unblock' : 'Block for me'}
            </DropdownItem>
            <DropdownItem icon={<FlagIcon />} onSelect={() => onReport(name)}>
              Report
            </DropdownItem>
          </>
        )}

        {/* Host-only enforcement. */}
        {canModerate && (
          <>
            <DropdownSeparator />
            <DropdownItem icon={<MicOffIcon />} disabled={micMuted} onSelect={forceMute}>
              Mute
            </DropdownItem>
            <DropdownItem icon={<CameraOffIcon />} disabled={!hasCamera} onSelect={disableVideo}>
              Turn off camera
            </DropdownItem>
            {/* Promote/demote — primary host only (server-enforced). */}
            {canManageCoHost && (
              <DropdownItem
                icon={<CrownIcon />}
                onSelect={() => onToggleCoHost(participant.identity, !isCoHost)}
              >
                {isCoHost ? 'Remove co-host' : 'Make co-host'}
              </DropdownItem>
            )}
            <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={remove}>
              Remove from call
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </li>
  )
}
