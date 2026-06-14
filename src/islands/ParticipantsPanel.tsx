import { useMemo, useState, type FormEvent } from 'react'
import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
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
import { CheckIcon, CopyIcon, HandIcon, LeaveIcon, MicIcon, MicOffIcon, MoreIcon, PinIcon } from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { useHandRaised } from '@/features/reactions/useReactions'
import { useRoomStore } from '@/store/useRoomStore'
import { useCopyLink } from '@/lib/useCopyLink'
import { moderate } from '@/lib/orchestrator'
import { cn } from '@/lib/cn'

function displayName(p: Participant): string {
  return p.name || p.identity.split('#')[0] || 'Guest'
}

/** Roster with live state (speaking / mic / hand / connection) and per-row actions. */
export function ParticipantsPanel() {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const { copied, copy } = useCopyLink()
  const [email, setEmail] = useState('')

  const isHost = useMemo(() => {
    try {
      return Boolean(JSON.parse(localParticipant.metadata || '{}').host)
    } catch {
      return false
    }
  }, [localParticipant.metadata])

  function emailInvite(e: FormEvent) {
    e.preventDefault()
    const to = email.trim()
    if (!to) return
    const subject = encodeURIComponent("You're invited to a Manim call")
    const body = encodeURIComponent(`Join my call:\n\n${window.location.href}`)
    window.open(`mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`, '_blank')
    setEmail('')
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
          <Button type="submit" variant="accent" size="sm" disabled={!email.trim()}>
            Invite
          </Button>
        </form>

        <p className="mt-3 text-xs font-medium text-ink-subtle">{participants.length} in call</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {participants.map((p) => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            isLocal={p.identity === localParticipant.identity}
            canModerate={isHost && p.identity !== localParticipant.identity}
            room={room.name}
            caller={localParticipant.identity}
          />
        ))}
      </ul>
    </div>
  )
}

function ParticipantRow({
  participant,
  isLocal,
  canModerate,
  room,
  caller,
}: {
  participant: Participant
  isLocal: boolean
  canModerate: boolean
  room: string
  caller: string
}) {
  const speaking = useIsSpeaking(participant)
  const micRef = { participant, source: Track.Source.Microphone } as TrackReferenceOrPlaceholder
  const micMuted = useIsMuted(micRef)
  const handRaised = useHandRaised(participant)

  const pinned = useRoomStore((s) => s.pinned) === participant.identity
  const togglePin = useRoomStore((s) => s.togglePin)

  const name = displayName(participant)

  async function forceMute() {
    const trackSid = participant.getTrackPublication(Track.Source.Microphone)?.trackSid
    if (!trackSid) return
    try {
      await moderate({ room, caller, target: participant.identity, action: 'mute', trackSid })
    } catch {
      /* surfaced elsewhere; ignore here */
    }
  }

  async function remove() {
    try {
      await moderate({ room, caller, target: participant.identity, action: 'remove' })
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
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-warning text-white [&_svg]:size-2.5">
            <HandIcon />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {isLocal && <span className="text-ink-subtle"> (you)</span>}
        </p>
        {pinned && (
          <Badge tone="accent" className="mt-0.5">
            <PinIcon className="size-3" /> Pinned
          </Badge>
        )}
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
        {canModerate && (
          <>
            <DropdownSeparator />
            <DropdownItem icon={<MicOffIcon />} disabled={micMuted} onSelect={forceMute}>
              Mute
            </DropdownItem>
            <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={remove}>
              Remove from call
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </li>
  )
}
