import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Avatar, Button, Dialog, IconButton, Popover, Tabs, TabPanel } from '@/components/primitives'
import { CameraIcon, CheckIcon, CloseIcon, PeopleIcon } from '@/components/icons'
import { useContactsStore, type ContactRow } from '@/store/useContactsStore'
import { cn } from '@/lib/cn'

interface ContactsActions {
  /** Start a fresh call with a contact (landing). `roomName` is the optional
   *  meeting name the user typed; empty → a random room. */
  onCall?: (c: ContactRow, roomName: string) => void
  /** Ring a contact into the current room (in-call). Shown as "Add to call". */
  onAddToCall?: (c: ContactRow) => void
}

export interface ContactsDialogProps extends ContactsActions {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Contacts manager: your mutual contacts, plus incoming requests to agree to and
 * outgoing requests you can cancel. Consent-based — adding someone sends a request
 * they must accept; either side can remove the contact later. Signed-in only.
 *
 * Two surfaces share the same body: a full Dialog (used in-call, from the People
 * panel) and a header Popover (landing — anchored, no scrim, like Setup status).
 * The confirm steps (name-the-meeting / remove) live at the wrapper level, not
 * inside the body, so they survive the popover closing.
 */
export function ContactsDialog({ open, onOpenChange, onCall, onAddToCall }: ContactsDialogProps) {
  const [pendingCall, setPendingCall] = useState<ContactRow | null>(null)
  const [pendingRemove, setPendingRemove] = useState<ContactRow | null>(null)
  const remove = useContactsStore((s) => s.remove)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Contacts"
      description="Call people you've saved, and manage requests."
    >
      <ContactsBody
        active={open}
        onAddToCall={onAddToCall}
        onRequestCall={onCall ? setPendingCall : undefined}
        onRequestRemove={setPendingRemove}
        className="min-h-0 flex-1"
      />
      <CallNameDialog
        contact={pendingCall}
        onClose={() => setPendingCall(null)}
        onSubmit={(name) => {
          const c = pendingCall
          setPendingCall(null)
          if (c) onCall?.(c, name)
        }}
      />
      <RemoveConfirmDialog
        contact={pendingRemove}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          const c = pendingRemove
          setPendingRemove(null)
          if (c) void remove(c.otherId)
        }}
      />
    </Dialog>
  )
}

/** Landing-header contacts: anchored popover (no overlay), Setup-status style. */
export function ContactsPopover({ onCall, onAddToCall }: ContactsActions) {
  const [open, setOpen] = useState(false)
  const [pendingCall, setPendingCall] = useState<ContactRow | null>(null)
  const [pendingRemove, setPendingRemove] = useState<ContactRow | null>(null)
  const remove = useContactsStore((s) => s.remove)
  const incoming = useContactsStore((s) => s.rows.filter((r) => r.direction === 'incoming').length)

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="end"
        className="w-80"
        trigger={
          <IconButton
            label="Contacts"
            icon={
              <span className="relative inline-flex">
                <PeopleIcon />
                {incoming > 0 && (
                  <span
                    className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-sunken"
                    aria-hidden
                  />
                )}
              </span>
            }
            tone="neutral"
          />
        }
      >
        <div className="flex max-h-[26rem] flex-col">
          <p className="px-1 pb-2 text-xs font-medium text-ink-subtle">Contacts</p>
          <ContactsBody
            active={open}
            onAddToCall={onAddToCall}
            onRequestCall={
              onCall
                ? (c) => {
                    setOpen(false)
                    setPendingCall(c)
                  }
                : undefined
            }
            onRequestRemove={(c) => {
              setOpen(false)
              setPendingRemove(c)
            }}
            className="min-h-0 flex-1"
          />
        </div>
      </Popover>

      <CallNameDialog
        contact={pendingCall}
        onClose={() => setPendingCall(null)}
        onSubmit={(name) => {
          const c = pendingCall
          setPendingCall(null)
          if (c) onCall?.(c, name)
        }}
      />
      <RemoveConfirmDialog
        contact={pendingRemove}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          const c = pendingRemove
          setPendingRemove(null)
          if (c) void remove(c.otherId)
        }}
      />
    </>
  )
}

interface ContactsBodyProps {
  /** True when the surface is visible — triggers a refresh of the lists. */
  active: boolean
  onAddToCall?: (c: ContactRow) => void
  onRequestCall?: (c: ContactRow) => void
  onRequestRemove: (c: ContactRow) => void
  className?: string
}

function ContactsBody({
  active,
  onAddToCall,
  onRequestCall,
  onRequestRemove,
  className,
}: ContactsBodyProps) {
  const rows = useContactsStore((s) => s.rows)
  const loading = useContactsStore((s) => s.loading)
  const error = useContactsStore((s) => s.error)
  const refresh = useContactsStore((s) => s.refresh)
  const [tab, setTab] = useState('contacts')

  // Reload whenever the surface opens so the lists are fresh (no realtime here —
  // requests are low-frequency; a pull on open is enough).
  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  const accepted = useMemo(() => rows.filter((r) => r.direction === 'accepted'), [rows])
  const incoming = useMemo(() => rows.filter((r) => r.direction === 'incoming'), [rows])
  const outgoing = useMemo(() => rows.filter((r) => r.direction === 'outgoing'), [rows])

  const items = [
    { value: 'contacts', label: `Contacts${accepted.length ? ` (${accepted.length})` : ''}` },
    {
      value: 'requests',
      label: (
        <span className="flex items-center gap-1.5">
          Requests
          {incoming.length > 0 && (
            <span className="grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
              {incoming.length}
            </span>
          )}
        </span>
      ),
    },
    { value: 'add', label: 'Add' },
  ]

  return (
    <Tabs items={items} value={tab} onValueChange={setTab} className={className}>
      <TabPanel value="contacts" className="mt-3 min-h-0 overflow-y-auto">
        {error && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-field bg-sunken px-3 py-2 text-xs text-danger">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-medium text-ink-muted hover:text-ink"
            >
              Retry
            </button>
          </div>
        )}
        {accepted.length === 0 ? (
          <Empty
            title={loading ? 'Loading…' : error ? "Couldn't load contacts" : 'No contacts yet'}
            hint={
              error
                ? 'Check your connection and retry.'
                : "Add someone by email in the Add tab. They'll appear here once they accept."
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {accepted.map((c) => (
              <Row key={c.otherId} contact={c}>
                {onAddToCall && (
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={!c.email}
                    onClick={() => onAddToCall(c)}
                  >
                    Add to call
                  </Button>
                )}
                {onRequestCall && (
                  <IconButton
                    size="sm"
                    tone="accent"
                    label={c.email ? `Call ${c.name}` : `No email on file for ${c.name}`}
                    icon={<CameraIcon />}
                    disabled={!c.email}
                    onClick={() => onRequestCall(c)}
                  />
                )}
                <IconButton
                  size="sm"
                  tone="neutral"
                  label={`Remove ${c.name}`}
                  icon={<CloseIcon />}
                  onClick={() => onRequestRemove(c)}
                />
              </Row>
            ))}
          </ul>
        )}
      </TabPanel>

      <TabPanel value="requests" className="mt-3 min-h-0 overflow-y-auto">
        {incoming.length === 0 && outgoing.length === 0 ? (
          <Empty
            title="No requests"
            hint="Incoming requests to add you — and ones you've sent — show up here."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {incoming.length > 0 && (
              <Section title="Wants to add you">
                {incoming.map((c) => (
                  <Row key={c.otherId} contact={c}>
                    <AcceptButton contact={c} />
                    <RemoveButton contact={c} label="Decline request" icon={<CloseIcon />} />
                  </Row>
                ))}
              </Section>
            )}
            {outgoing.length > 0 && (
              <Section title="Sent">
                {outgoing.map((c) => (
                  <Row key={c.otherId} contact={c}>
                    <span className="text-xs text-ink-subtle">Pending</span>
                    <RemoveButton contact={c} label="Cancel request" icon={<CloseIcon />} />
                  </Row>
                ))}
              </Section>
            )}
          </div>
        )}
      </TabPanel>

      <TabPanel value="add" className="mt-3">
        <AddByEmail onAdded={() => setTab('requests')} />
      </TabPanel>
    </Tabs>
  )
}

/** "Name the meeting (optional)" step before starting a call with a contact. */
function CallNameDialog({
  contact,
  onClose,
  onSubmit,
}: {
  contact: ContactRow | null
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (contact) setName('')
  }, [contact])
  return (
    <Dialog
      open={contact !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Call ${contact?.name ?? ''}`}
      description="Name the meeting (optional), then start the call."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(name)
        }}
        className="flex flex-col gap-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Meeting name (optional) — e.g. Design sync"
          aria-label="Meeting name"
          autoComplete="off"
          autoFocus
          className="h-11 rounded-field bg-sunken px-3.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="accent">
            <CameraIcon /> Start call
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Confirm removing an accepted contact (drops you from each other's lists). */
function RemoveConfirmDialog({
  contact,
  onClose,
  onConfirm,
}: {
  contact: ContactRow | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={contact !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${contact?.name ?? ''}?`}
      description="You'll be removed from each other's contacts. You can send a new request later."
    >
      <div className="flex justify-end gap-2">
        <Button variant="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Remove
        </Button>
      </div>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-1 text-xs font-medium text-ink-subtle">{title}</p>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  )
}

function Row({ contact, children }: { contact: ContactRow; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 rounded-field px-1 py-1.5">
      <Avatar name={contact.name} src={contact.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{contact.name}</p>
        {contact.email && <p className="truncate text-xs text-ink-subtle">{contact.email}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </li>
  )
}

function AcceptButton({ contact }: { contact: ContactRow }) {
  const accept = useContactsStore((s) => s.accept)
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="accent"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await accept(contact.otherId)
        setBusy(false)
      }}
    >
      <CheckIcon className="size-4" />
      Accept
    </Button>
  )
}

function RemoveButton({
  contact,
  label,
  icon,
}: {
  contact: ContactRow
  label: string
  icon?: React.ReactNode
}) {
  const remove = useContactsStore((s) => s.remove)
  const [busy, setBusy] = useState(false)
  return (
    <IconButton
      size="sm"
      tone="neutral"
      label={label}
      icon={icon ?? <CloseIcon />}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await remove(contact.otherId)
        setBusy(false)
      }}
    />
  )
}

function AddByEmail({ onAdded }: { onAdded: () => void }) {
  const addByEmail = useContactsStore((s) => s.addByEmail)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setMsg(null)
    const err = await addByEmail(email)
    setBusy(false)
    if (err) {
      setMsg({ kind: 'err', text: err })
    } else {
      setMsg({ kind: 'ok', text: 'Request sent.' })
      setEmail('')
      onAdded()
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="contact-email" className="text-sm font-medium">
        Add by email
      </label>
      <input
        id="contact-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="them@email.com"
        autoComplete="off"
        className="h-11 rounded-field bg-sunken px-3.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
      />
      <Button type="submit" variant="accent" disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Send request'}
      </Button>
      {msg && (
        <p className={cn('text-xs', msg.kind === 'ok' ? 'text-success' : 'text-danger')}>
          {msg.text}
        </p>
      )}
      <p className="text-xs text-ink-subtle">
        They must accept before you're connected. Both of you can remove the contact anytime.
      </p>
    </form>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid place-items-center px-4 py-10 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-ink-muted">{hint}</p>
      </div>
    </div>
  )
}
