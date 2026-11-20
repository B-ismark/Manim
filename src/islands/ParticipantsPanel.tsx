import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
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
  Dialog,
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
  ShareIcon,
  ChevronDownIcon,
} from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { ContactsDialog } from '@/islands/Contacts'
import { AddPeople } from '@/islands/AddPeople'
import type { ContactRow } from '@/store/useContactsStore'
import { handQueue, useHandRaised } from '@/features/reactions/useReactions'
import { CONTROL_TOPIC } from '@/features/session/useSessionControl'
import { useRoomStore } from '@/store/useRoomStore'
import { useWaitingStore } from '@/store/useWaitingStore'
import { nameMatches, searchMin } from '@/lib/nameSearch'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useBlockStore } from '@/store/useBlockStore'
import { useInviteStore } from '@/store/useInviteStore'
import { toast } from '@/store/useToastStore'
import { useShareLink } from '@/lib/useShareLink'
import { useMyOtherSeats } from '@/lib/sameAccount'
import { moderate, sendEmailInvite, setRoomFlags } from '@/lib/orchestrator'
import { countSettled } from '@/lib/settle'
import { displayNameOf } from '@/lib/participantName'
import { RING_TTL_MS, ringUser } from '@/features/calls/calls'
import { authEnabled } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { linkWithoutKey, parseRoomHash } from '@/lib/roomLink'
import { resolveRoomSecrets } from '@/lib/roomKeys'
import { publishTagged } from '@/lib/useDataTopic'
import { ROSTER_EVENTS } from '@/lib/rosterEvents'

function displayName(p: Participant): string {
  return displayNameOf(p.identity, p.name)
}

/** Roster with live state (speaking / mic / hand / connection) and per-row actions. */
export function ParticipantsPanel() {
  // Each row follows its own speaking state (useIsSpeaking), so the list doesn't.
  const participants = useParticipants({ updateOnlyOn: ROSTER_EVENTS })
  // Raised hands first, in the order they went up, so the host reads the queue
  // top-down; everyone else keeps the list's own order.
  const handOrder = handQueue(participants)
  const byHand = [
    ...handOrder.flatMap((id) => participants.filter((p) => p.identity === id)),
    ...participants.filter((p) => !handOrder.includes(p.identity)),
  ]
  // Re-sorting MOVES rows in the DOM, and moving the row that holds focus drops
  // it to <body> — a host tabbing through the list would be thrown back to the
  // top of the page whenever someone raised or lowered a hand. Note what holds
  // focus inside the list as this render starts (the DOM hasn't moved yet) and
  // put it back after the commit if the move dropped it.
  const listRef = useRef<HTMLUListElement>(null)
  const focusBefore = useRef<Element | null>(null)
  const order = byHand.map((p) => p.identity).join('\n')
  if (typeof document !== 'undefined') {
    const active = document.activeElement
    focusBefore.current = active && listRef.current?.contains(active) ? active : null
  }
  useLayoutEffect(() => {
    const el = focusBefore.current
    if (el instanceof HTMLElement && el.isConnected && document.activeElement !== el) {
      el.focus({ preventScroll: true })
    }
  }, [order])
  // Search and sections (Teams' People: a search box, then Waiting / In this
  // call / Invited, each with its count and its bulk action in its own header,
  // so it's clear who "Mute all" or "Admit all" applies to).
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Record<SectionId, boolean>>({ waiting: false, call: false, invited: false })
  const toggleSection = (id: SectionId) => setFolded((f) => ({ ...f, [id]: !f[id] }))
  const waitingAll = useWaitingStore((s) => s.pending)
  const decideKnock = useWaitingStore((s) => s.decide)
  // Deciding on someone removes their row, and the button you pressed with it:
  // focus would fall to <body>. Hand it to the next person waiting (or, when
  // that was the last, the In this call header) once the row has gone.
  const focusNext = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { localParticipant } = useLocalParticipant()
  // Your other devices, by the server's signature (metadata alone can be edited).
  const otherSeats = useMyOtherSeats()
  const room = useRoomContext()
  const { copied, copy } = useShareLink()
  const [callMsg, setCallMsg] = useState<string | null>(null)
  // Set when the server couldn't send (not configured, or provider rejected the
  // recipient). We render a real mailto link the user can click — a programmatic
  // window.open after an await is killed by popup blockers, so a click is the
  // only reliable fallback.
  const [mailto, setMailto] = useState<{ href: string; to: string } | null>(null)
  const signedIn = useAuthStore((s) => s.signedIn)
  const canRing = authEnabled && signedIn
  const [contactsOpen, setContactsOpen] = useState(false)
  // Display names aren't unique (esp. guests). Flag the ones shared by >1 person
  // so the roster can disambiguate them with a short id suffix.
  const dupNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of participants) {
      const n = displayName(p).toLowerCase()
      counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, c]) => c > 1).map(([n]) => n))
  }, [participants])
  const roomToken = useAppStore((s) => s.roomToken)
  const { metadata: roomMetadata } = useRoomInfo()
  const joinUrl = typeof window !== 'undefined' ? window.location.href : ''
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  async function nativeShare() {
    try {
      await navigator.share({ title: `Join the call`, url: joinUrl })
    } catch {
      /* user cancelled / unsupported */
    }
  }
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
  const { isPrimaryHost, coHosts, hostId } = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      return {
        isPrimaryHost: f.hostId === localParticipant.identity,
        coHosts: Array.isArray(f.coHosts) ? (f.coHosts as string[]) : [],
        hostId: typeof f.hostId === 'string' ? f.hostId : '',
      }
    } catch {
      return { isPrimaryHost: false, coHosts: [] as string[], hostId: '' }
    }
  }, [roomMetadata, localParticipant.identity])
  // Co-hosts get the moderation UI too; only the primary host manages the roster.
  const isHost = isPrimaryHost || coHosts.includes(localParticipant.identity)

  // Waiting is the host's to act on; nobody else sees the queue (it's sealed).
  const waitingList = isHost ? waitingAll : []
  const total = participants.length + waitingList.length + ghostInvites.length
  const showSearch = total >= searchMin()
  const searching = showSearch && query.trim() !== ''
  const shownCall = searching ? byHand.filter((p) => nameMatches(displayName(p), query)) : byHand
  const shownWaiting = searching ? waitingList.filter((p) => nameMatches(p.name, query)) : waitingList
  // "Ringing…" is only true for as long as the ring itself (RING_TTL_MS, after
  // which the callee's ring gives up). Tick while a ring is that young, so the
  // row moves on to "No answer yet" even if nothing else redraws the panel.
  const [now, setNow] = useState(() => Date.now())
  // The next ring to stop (the soonest end still in the future), re-armed after each.
  const nextRingEnd = Math.min(
    Infinity,
    ...ghostInvites.filter((i) => i.kind === 'ring' && i.ts + RING_TTL_MS > now).map((i) => i.ts + RING_TTL_MS),
  )
  useEffect(() => {
    if (!Number.isFinite(nextRingEnd)) return
    const t = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextRingEnd - Date.now()) + 50)
    return () => window.clearTimeout(t)
  }, [nextRingEnd])
  const shownInvites = searching ? ghostInvites.filter((i) => nameMatches(i.label, query)) : ghostInvites
  // Searching opens every section: a match inside a folded one would be invisible.
  const isOpen = (id: SectionId) => searching || !folded[id]
  const decide = (k: { id: string }, approve: boolean) => {
    const i = shownWaiting.findIndex((w) => w.id === k.id)
    const next = shownWaiting[i + 1] ?? shownWaiting[i - 1]
    focusNext.current = next ? `admit-${next.id}` : 'section-call'
    decideKnock(k as (typeof shownWaiting)[number], approve)
  }
  useLayoutEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    const root = scrollRef.current
    const el = target.startsWith('admit-')
      ? root?.querySelector<HTMLElement>(`[data-admit="${CSS.escape(target.slice(6))}"]`)
      : root?.querySelector<HTMLElement>('[data-section="call"] button[aria-expanded]')
    // Only if the press really dropped it — never pull focus from somewhere else.
    if (el && (document.activeElement === document.body || !document.activeElement?.isConnected)) {
      el.focus({ preventScroll: false })
    }
  }, [shownWaiting.length])
  // The box goes away when the list gets short again (people left); don't keep
  // a search nobody can see, waiting to filter the list the next time it appears.
  useEffect(() => {
    if (!showSearch && query) setQuery('')
  }, [showSearch, query])


  async function toggleCoHost(identity: string, on: boolean) {
    if (!isPrimaryHost) return
    if (!roomToken) return toast('Reconnecting — try again in a moment', 'neutral')
    const next = on ? [...coHosts, identity] : coHosts.filter((id) => id !== identity)
    try {
      await setRoomFlags({ room: room.name, token: roomToken, coHosts: next })
    } catch {
      toast(on ? 'Couldn’t make them a co-host — try again' : 'Couldn’t remove them as co-host — try again', 'danger')
    }
  }

  // Removing someone is disruptive + can't be undone → confirm first.
  const [removeTarget, setRemoveTarget] = useState<{ identity: string; name: string } | null>(null)
  async function confirmRemove() {
    const target = removeTarget
    setRemoveTarget(null)
    if (!target) return
    if (!roomToken) return toast('Reconnecting — try again in a moment', 'neutral')
    try {
      await moderate({ room: room.name, token: roomToken, target: target.identity, action: 'remove' })
      toast(`Removed ${target.name}`, 'neutral')
    } catch {
      toast(`Couldn’t remove ${target.name} — try again`, 'danger')
    }
  }

  function mailtoHref(to: string): string {
    const { href, hadKey } = linkWithoutKey(window.location.href)
    const subject = encodeURIComponent("You’re invited to a Manim call")
    const note = hadKey
      ? "\n\nThis call is end-to-end encrypted, so the encryption key isn’t in this email. I’ll send you the full link separately."
      : ''
    const body = encodeURIComponent(`Join my call:\n\n${href}${note}`)
    return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
  }

  /** Fall back to the user's mail client: best-effort auto-open + a click target. */
  function fallbackToMailto(to: string) {
    const href = mailtoHref(to)
    setMailto({ href, to })
    setCallMsg(null)
    addInvite(to, 'email')
    window.open(href, '_blank') // best effort; popup blockers may ignore it
  }

  // Both return whether the address was accepted — AddPeople owns the input now,
  // and clears it only on success, which is the behaviour this panel had before.
  async function emailInvite(to: string): Promise<boolean> {
    if (!to) return false
    setMailto(null)
    const who = localParticipant.name || 'Someone'
    try {
      // Try a real email first; fall back to the mail client if the server has
      // no provider configured or the provider rejects the recipient.
      const { href, hadKey: encrypted } = linkWithoutKey(window.location.href)
      const sent = await sendEmailInvite(to, room.name, href, who, roomToken ?? undefined)
      if (sent) {
        // The key stays out of the email, so say what the guest still needs.
        setCallMsg(
          encrypted
            ? `Invite emailed to ${to}. This call is encrypted, so also send them the full link.`
            : `Invite emailed to ${to}`,
        )
        addInvite(to, 'email')
        return true
      }
      fallbackToMailto(to)
      return false
    } catch {
      // The panel says so inline, next to the mail link it offers instead.
      fallbackToMailto(to)
      return false
    }
  }

  // A ring carries the room's secrets, as Landing's does: without them the person
  // you ring is stopped at the door (need_link, or need_key in an encrypted call).
  const ringSecrets = () => resolveRoomSecrets(room.name, parseRoomHash(window.location.hash))

  async function ring(to: string): Promise<boolean> {
    if (!to) return false
    setCallMsg('Ringing…')
    const err = await ringUser(to, room.name, localParticipant.name || 'Someone', ringSecrets())
    setCallMsg(err ?? `Ringing ${to}…`)
    if (err) return false
    addInvite(to, 'ring')
    return true
  }

  // Ring a saved contact into THIS room (the in-call "add to call" path).
  async function addContactToCall(c: ContactRow) {
    setContactsOpen(false)
    if (!c.email) return
    setCallMsg('Ringing…')
    const err = await ringUser(c.email, room.name, localParticipant.name || 'Someone', ringSecrets())
    setCallMsg(err ?? `Ringing ${c.name}…`)
    // Label by name (not email) so the "Invited · waiting" row clears when they
    // join (the ghost matches against participant display names).
    if (!err) addInvite(c.name, 'ring')
  }

  // Report flags a participant to the host over the control channel. It is
  // addressed to the host and co-hosts only: broadcast, it reached every device in
  // the call — the reported person's included — which is who it has to be hidden
  // from. No central moderation backend — keeps it lightweight.
  async function reportUser(targetIdentity: string, targetName: string) {
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'report', target: targetName, by: localParticipant.name || 'Someone' }),
    )
    // Only hosts who are actually here (metadata can still name one who left, and a
    // report addressed to nobody would say "reported" anyway), never the person
    // being reported (a co-host can be), never yourself.
    const present = new Set(participants.map((p) => p.identity))
    const hosts = [...new Set([hostId, ...coHosts])].filter(
      (id) => !!id && id !== localParticipant.identity && id !== targetIdentity && present.has(id),
    )
    if (hosts.length === 0) {
      toast('There’s no host in this call to report to', 'warning')
      return
    }
    try {
      await publishTagged(room, CONTROL_TOPIC, payload, {
        reliable: true,
        destinationIdentities: hosts,
      })
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
    // Count what actually changed — "Muted everyone" when nobody had an open mic
    // is a false claim that sends the host re-checking every tile. `moderate`
    // resolves to void, so only fulfilment-vs-rejection carries the signal;
    // countSettled owns that (see lib/settle.ts). A rejected request (postJson
    // throws on non-2xx) doesn't count as changed.
    const n = await countSettled(
      targets.map((p) => {
        const pub = p.getTrackPublication(source)
        if (!pub || pub.isMuted || !pub.trackSid) return undefined
        return moderate({
          room: room.name,
          token: roomToken,
          target: p.identity,
          action: 'mute',
          trackSid: pub.trackSid,
          source: kind === 'camera' ? 'camera' : 'microphone',
        })
      }),
    )
    if (n === 0) {
      toast(kind === 'mic' ? 'Everyone was already muted' : 'No one’s camera was on', 'neutral')
      return
    }
    toast(
      kind === 'mic'
        ? `Muted ${n} ${n === 1 ? 'microphone' : 'microphones'}`
        : `Turned off ${n} ${n === 1 ? 'camera' : 'cameras'}`,
      'neutral',
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContactsDialog open={contactsOpen} onOpenChange={setContactsOpen} onAddToCall={addContactToCall} />
      <div className="px-3 pt-3">
        <div className="flex gap-2">
          <Button variant="neutral" block onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {canNativeShare && (
            <Button variant="neutral" onClick={nativeShare} aria-label="Share invite">
              <ShareIcon />
            </Button>
          )}
        </div>

        <AddPeople
          canRing={canRing}
          onInviteEmail={emailInvite}
          onRingEmail={ring}
          onAddContact={addContactToCall}
          onOpenContacts={() => setContactsOpen(true)}
        />
        {callMsg && <p className="mt-1 text-xs text-ink-muted">{callMsg}</p>}
        {mailto && (
          <p className="mt-1 text-xs text-ink-muted">
            Couldn’t email automatically.{' '}
            <a
              href={mailto.href}
              className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
              // The address box lives in AddPeople now and clears itself only on
              // success; a mailto fallback is not success, so there is nothing to
              // clear here beyond dismissing this notice.
              onClick={() => setMailto(null)}
            >
              Open mail app to invite {mailto.to}
            </a>
          </p>
        )}

        {showSearch && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Esc clears a search before it closes the panel: while there's text
            // the field owns the key (Radix hears it first, in capture — see
            // ownsEscape); empty, Esc closes People as it always has.
            data-own-escape={query ? '' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) setQuery('')
            }}
            placeholder="Search people"
            aria-label="Search people"
            autoComplete="off"
            className="mt-3 h-9 w-full rounded-field bg-sunken px-3 text-base outline-none sm:text-sm placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1 no-scrollbar">
        {shownWaiting.length > 0 && (
          <Section
            id="waiting"
            title="Waiting"
            count={shownWaiting.length}
            open={isOpen('waiting')}
            onToggle={toggleSection}
            action={
              shownWaiting.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    focusNext.current = 'section-call'
                    for (const k of shownWaiting) decideKnock(k, true)
                  }}
                >
                  {searching ? `Admit ${shownWaiting.length}` : 'Admit all'}
                </Button>
              )
            }
          >
            {shownWaiting.map((k) => (
              <li key={k.id} className="flex items-center gap-3 rounded-field px-2 py-1.5">
                <Avatar name={k.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-medium">{k.name}</p>
                  {k.note && (
                    <p dir="auto" className="truncate text-xs text-ink-muted" title={k.note}>
                      “{k.note}”
                    </p>
                  )}
                </div>
                {/* Full size, both labelled: as in the banner, admitting or denying
                    a person is consequential, and in a phone's sheet these are thumb
                    targets side by side. */}
                <Button variant="accent" data-admit={k.id} aria-label={`Admit ${k.name}`} onClick={() => decide(k, true)}>
                  Admit
                </Button>
                <Button variant="ghost" aria-label={`Deny ${k.name}`} onClick={() => decide(k, false)}>
                  Deny
                </Button>
              </li>
            ))}
          </Section>
        )}

        <Section
          id="call"
          title="In this call"
          count={searching ? shownCall.length : participants.length}
          open={isOpen('call')}
          onToggle={toggleSection}
          listRef={listRef}
          action={
            // Not while searching: the header would read "In this call (1)" and
            // Mute all would still mute all twelve. (Admit all narrows to its
            // matches instead, because admitting a subset is a real choice;
            // muting "everyone I searched for" is not.)
            isHost &&
            !searching &&
            participants.length > 1 && (
              <span className="flex shrink-0 items-center">
                <Button variant="ghost" size="sm" onClick={() => muteAll(Track.Source.Microphone, 'mic')}>
                  Mute all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => muteAll(Track.Source.Camera, 'camera')}>
                  Cameras off
                </Button>
              </span>
            )
          }
        >
          {shownCall.map((p) => (
            <ParticipantRow
              key={p.identity}
              participant={p}
              handPosition={handOrder.indexOf(p.identity) + 1 || null}
              ambiguous={dupNames.has(displayName(p).toLowerCase())}
              isLocal={p.identity === localParticipant.identity}
              myOtherDevice={!p.isLocal && !!p.sid && otherSeats.has(p.sid)}
              canModerate={isHost && p.identity !== localParticipant.identity}
              canManageCoHost={isPrimaryHost && p.identity !== localParticipant.identity}
              isCoHost={coHosts.includes(p.identity)}
              onToggleCoHost={toggleCoHost}
              onRequestRemove={(identity, name) => setRemoveTarget({ identity, name })}
              room={room.name}
              token={roomToken}
              onReport={reportUser}
            />
          ))}
        </Section>

        {shownInvites.length > 0 && (
          <Section
            id="invited"
            title="Invited"
            count={shownInvites.length}
            open={isOpen('invited')}
            onToggle={toggleSection}
          >
            {shownInvites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-field px-2 py-1.5 opacity-70">
                <Avatar name={inv.label} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.label}</p>
                  <p className="text-xs text-ink-subtle">{inviteStatus(inv, now)}</p>
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
          </Section>
        )}

        {searching && shownCall.length + shownWaiting.length + shownInvites.length === 0 && (
          <p role="status" className="px-2 py-6 text-center text-sm text-ink-muted">
            No one called “{query.trim()}” here
          </p>
        )}
      </div>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? ''}?`}
        description="They’ll be disconnected, and can’t rejoin this call from the same browser or account."
      >
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmRemove}>
            <LeaveIcon /> Remove
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function ParticipantRow({
  participant,
  handPosition,
  ambiguous,
  isLocal,
  myOtherDevice,
  canModerate,
  canManageCoHost,
  isCoHost,
  onToggleCoHost,
  onRequestRemove,
  room,
  token,
  onReport,
}: {
  participant: Participant
  /** Place in the raised-hand queue (1-based), or null when the hand is down. */
  handPosition: number | null
  /** This display name is shared with another participant — show a short id suffix. */
  ambiguous: boolean
  isLocal: boolean
  myOtherDevice: boolean
  canModerate: boolean
  canManageCoHost: boolean
  isCoHost: boolean
  onToggleCoHost: (identity: string, on: boolean) => void
  onRequestRemove: (identity: string, name: string) => void
  room: string
  token: string | null
  onReport: (targetIdentity: string, targetName: string) => void
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
    if (!trackSid) return
    if (!token) return toast('Reconnecting — try again in a moment', 'neutral')
    try {
      await moderate({ room, token, target: participant.identity, action: 'mute', trackSid, source: 'microphone' })
      toast(`Muted ${name}`, 'neutral')
    } catch {
      toast(`Couldn’t mute ${name} — try again`, 'danger')
    }
  }

  async function disableVideo() {
    const trackSid = camPub?.trackSid
    if (!trackSid || !token) return
    try {
      await moderate({ room, token, target: participant.identity, action: 'mute', trackSid, source: 'camera' })
      toast(`Turned off ${name}’s camera`, 'neutral')
    } catch {
      toast(`Couldn’t turn off ${name}’s camera — try again`, 'danger')
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
        <p dir="auto" className="truncate text-sm font-medium">
          {name}
          {ambiguous && !isLocal && (
            <span className="text-ink-subtle"> ·{participant.identity.split('#')[1]?.slice(0, 4) ?? ''}</span>
          )}
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
          {/* The queue in words: raised hands sort to the top in the order they
              went up, and this says which one you're looking at. */}
          {handRaised && handPosition && (
            <Badge tone="warning" className="mt-0.5">
              <HandIcon className="size-3" /> {ordinal(handPosition)} hand
            </Badge>
          )}
        </div>
      </div>

      {canModerate && !micMuted ? (
        // Host: tap a live mic to mute it. (You can't force-unmute someone —
        // turning on another person's mic is a privacy no-no, so a muted mic is
        // just an indicator.)
        <IconButton
          size="sm"
          tone="neutral"
          label={`Mute ${name}`}
          icon={<MicIcon />}
          onClick={forceMute}
        />
      ) : (
        <span className="text-ink-muted [&_svg]:size-4" title={micMuted ? 'Muted' : 'Unmuted'}>
          {micMuted ? <MicOffIcon className="text-danger-text" /> : <MicIcon />}
        </span>
      )}

      <ConnectionQuality participant={participant} degradedOnly />

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
            <DropdownItem icon={<FlagIcon />} onSelect={() => onReport(participant.identity, name)}>
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
            <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={() => onRequestRemove(participant.identity, name)}>
              Remove from call
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </li>
  )
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

type SectionId = 'waiting' | 'call' | 'invited'

/**
 * One group in People: a header that folds it away (with its count, and its
 * bulk action beside it so it's clear who that action is for), then its rows.
 * The header is a real heading wrapping a disclosure button, so a screen reader
 * can jump between sections and hear whether each is open.
 */
function Section({
  id,
  title,
  count,
  open,
  onToggle,
  action,
  listRef,
  children,
}: {
  id: SectionId
  title: string
  count: number
  open: boolean
  onToggle: (id: SectionId) => void
  action?: ReactNode
  listRef?: Ref<HTMLUListElement>
  children: ReactNode
}) {
  const listId = `people-section-${id}`
  return (
    <section aria-label={`${title} (${count})`} data-section={id} className="mt-1">
      {/* Sticky, so a section's bulk action is still within reach after
          scrolling down a long list (it used to be pinned under the list). */}
      <div className="sticky top-0 z-10 flex min-h-9 items-center gap-1 bg-surface pr-1">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => onToggle(id)}
            className="flex w-full items-center gap-1 rounded-field px-1 py-1.5 text-left text-xs font-medium text-ink-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-3.5"
          >
            <span className={cn('transition-transform duration-[var(--dur-fast)]', open ? 'rotate-0' : '-rotate-90')}>
              <ChevronDownIcon />
            </span>
            <span className="truncate">
              {title} <span className="tabular-nums">({count})</span>
            </span>
          </button>
        </h3>
        {open && action}
      </div>
      <ul id={listId} ref={listRef} hidden={!open} className="space-y-1">
        {children}
      </ul>
    </section>
  )
}

function inviteStatus(inv: { kind: 'ring' | 'email'; ts: number }, now: number): string {
  if (inv.kind === 'email') return 'Invited by email'
  return now - inv.ts < RING_TTL_MS ? 'Ringing…' : 'No answer yet'
}
