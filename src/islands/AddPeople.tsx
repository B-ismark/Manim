import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Button } from '@/components/primitives'
import { ChevronDownIcon, PeopleIcon } from '@/components/icons'
import { useContactsStore, type ContactRow } from '@/store/useContactsStore'
import { cn } from '@/lib/cn'

/**
 * One place to name a person you want in the call.
 *
 * The People panel used to ask for that twice: an "Invite by email" field, and a
 * separate "Add from contacts" link into a three-tab modal. Two shapes, two
 * mental models, one intent — and between them they held five controls and two
 * lines of helper text permanently above a roster that is the reason the panel
 * exists. Measured at 146px of invite chrome over a single 44px participant row.
 *
 * Searching contacts and typing an address are the same gesture, so this is one
 * input. What you type filters saved contacts as you go (the @-mention pattern,
 * which people already know from tagging in comments); if it parses as an email
 * and matches nobody, the same box offers to invite or ring that address. The
 * duplicate entry point is removed rather than merely collapsed.
 *
 * Collapsed by default. Adding people is something you do once at the start of a
 * call; seeing who is in it is continuous. Copy link deliberately stays OUTSIDE
 * this disclosure — it is the zero-friction invite and the most-used one, so it
 * keeps its place in the panel.
 */
export function AddPeople({
  canRing,
  onInviteEmail,
  onRingEmail,
  onAddContact,
  onOpenContacts,
}: {
  /** Ringing needs auth + a saved-contact backend; without it this is email-only. */
  canRing: boolean
  /** Returns true when the address was accepted, which clears the box. */
  onInviteEmail: (to: string) => Promise<boolean>
  onRingEmail: (to: string) => Promise<boolean>
  onAddContact: (c: ContactRow) => void
  /** Opens the full contacts surface — only offered when a request is waiting. */
  onOpenContacts: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useContactsStore((s) => s.rows)
  const refresh = useContactsStore((s) => s.refresh)

  // Pull on open, matching how the contacts modal stays fresh — requests are
  // low-frequency, so there is no realtime subscription to justify here.
  useEffect(() => {
    if (open && canRing) void refresh()
  }, [open, canRing, refresh])

  // Focus the box on expand: the disclosure exists to be typed into, and a
  // keyboard user should not have to tab past it to reach it.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const accepted = useMemo(() => rows.filter((r) => r.direction === 'accepted'), [rows])
  const incoming = useMemo(() => rows.filter((r) => r.direction === 'incoming'), [rows])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return accepted
    return accepted.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
    )
  }, [accepted, q])

  // Deliberately loose. This decides whether to OFFER an address, not whether to
  // accept one — the server validates for real, and being strict here would hide
  // the action from anyone whose address this regex disagreed with.
  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(query.trim())
  const typed = query.trim()

  // Cap the resting list. The point of the section is a few familiar faces and a
  // way to search past them, not a scroll region competing with the roster below.
  const VISIBLE = 4
  const shown = q ? matches.slice(0, 8) : matches.slice(0, VISIBLE)
  const hiddenCount = (q ? matches.length : accepted.length) - shown.length

  async function run(fn: (to: string) => Promise<boolean>) {
    if (!typed || busy) return
    setBusy(true)
    try {
      if (await fn(typed)) setQuery('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-field px-3 py-2 text-sm font-medium',
          'text-ink transition-colors hover:bg-sunken [&_svg]:size-4',
          open && 'bg-sunken',
        )}
      >
        <PeopleIcon />
        Add people
        <ChevronDownIcon
          className={cn('ml-auto transition-transform duration-[var(--dur-fast)]', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-1.5">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && looksLikeEmail) {
                e.preventDefault()
                void run(onInviteEmail)
              }
            }}
            placeholder={canRing ? 'Search contacts or type an email' : 'Invite by email'}
            aria-label={canRing ? 'Search contacts or type an email address' : 'Invite by email'}
            autoComplete="off"
            className="h-9 w-full rounded-field bg-sunken px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />

          {/* The audit's L4 disclosure — that entering an address causes us to
              process and email it. It has to sit with the input that collects
              the address, so it moved in here with it rather than being cut. */}
          <p className="mt-1.5 text-xs text-ink-subtle">
            {canRing
              ? "We'll email them an invite, or ring them if they have an account."
              : "We'll email them an invite to join this call."}
          </p>

          {/* An address nobody is saved under: offer it directly, so one box
              covers both "someone I know" and "someone I don't". */}
          {looksLikeEmail && matches.length === 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-field bg-sunken px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{typed}</p>
                <p className="text-xs text-ink-subtle">Not in your contacts</p>
              </div>
              {canRing && (
                <Button size="sm" variant="neutral" disabled={busy} onClick={() => void run(onRingEmail)}>
                  Call
                </Button>
              )}
              <Button size="sm" variant="accent" disabled={busy} onClick={() => void run(onInviteEmail)}>
                Invite
              </Button>
            </div>
          )}

          {canRing && shown.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {shown.map((c) => (
                <li key={c.otherId} className="flex items-center gap-2.5 rounded-field px-1 py-1.5">
                  <Avatar name={c.name} src={c.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    {c.email && <p className="truncate text-xs text-ink-subtle">{c.email}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={!c.email}
                    onClick={() => onAddContact(c)}
                  >
                    Add to call
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {canRing && hiddenCount > 0 && (
            <p className="mt-1.5 px-1 text-xs text-ink-subtle">
              {q ? `+${hiddenCount} more match` : `+${hiddenCount} more`} — keep typing to narrow
            </p>
          )}

          {canRing && q && matches.length === 0 && !looksLikeEmail && (
            <p className="mt-2 px-1 text-xs text-ink-muted">
              No contacts match “{query.trim()}”. Type a full email address to invite someone new.
            </p>
          )}

          {/* Managing contacts is not an in-call task, so the three-tab surface is
              no longer wired to this panel — it lives on the landing page. The one
              exception is a request that is actually waiting, which you cannot act
              on anywhere else without leaving the call. */}
          {canRing && incoming.length > 0 && (
            <button
              type="button"
              onClick={onOpenContacts}
              className="mt-2 px-1 text-xs font-medium text-accent hover:text-accent-hover"
            >
              {incoming.length} contact {incoming.length === 1 ? 'request' : 'requests'} waiting
            </button>
          )}
        </div>
      )}
    </div>
  )
}
