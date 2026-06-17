import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Avatar, Button, Dialog, IconButton, Tabs, TabPanel } from '@/components/primitives'
import { CameraIcon, CheckIcon, CloseIcon } from '@/components/icons'
import { useContactsStore, type ContactRow } from '@/store/useContactsStore'
import { cn } from '@/lib/cn'

export interface ContactsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Start a fresh call with a contact (landing page). */
  onCall?: (c: ContactRow) => void
  /** Ring a contact into the current room (in-call). Shown as "Add to call". */
  onAddToCall?: (c: ContactRow) => void
}

/**
 * Contacts manager: your mutual contacts, plus incoming requests to agree to and
 * outgoing requests you can cancel. Consent-based — adding someone sends a request
 * they must accept; either side can remove the contact later. Signed-in only.
 */
export function ContactsDialog({ open, onOpenChange, onCall, onAddToCall }: ContactsDialogProps) {
  const rows = useContactsStore((s) => s.rows)
  const loading = useContactsStore((s) => s.loading)
  const refresh = useContactsStore((s) => s.refresh)
  const [tab, setTab] = useState('contacts')

  // Reload whenever the dialog opens so the lists are fresh (no realtime here —
  // requests are low-frequency; a pull on open is enough).
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

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
    <Dialog open={open} onOpenChange={onOpenChange} title="Contacts" description="Call people you've saved, and manage requests.">
      <Tabs items={items} value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabPanel value="contacts" className="mt-3 min-h-0 overflow-y-auto">
          {accepted.length === 0 ? (
            <Empty
              title={loading ? 'Loading…' : 'No contacts yet'}
              hint="Add someone by email in the Add tab. They'll appear here once they accept."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {accepted.map((c) => (
                <Row key={c.otherId} contact={c}>
                  {onAddToCall && (
                    <Button size="sm" variant="accent" onClick={() => onAddToCall(c)}>
                      Add to call
                    </Button>
                  )}
                  {onCall && (
                    <IconButton size="sm" tone="accent" label={`Call ${c.name}`} icon={<CameraIcon />} onClick={() => onCall(c)} />
                  )}
                  <RemoveButton contact={c} label="Remove contact" />
                </Row>
              ))}
            </ul>
          )}
        </TabPanel>

        <TabPanel value="requests" className="mt-3 min-h-0 overflow-y-auto">
          {incoming.length === 0 && outgoing.length === 0 ? (
            <Empty title="No requests" hint="Incoming requests to add you — and ones you've sent — show up here." />
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
      <Avatar name={contact.name} size="sm" />
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

function RemoveButton({ contact, label, icon }: { contact: ContactRow; label: string; icon?: React.ReactNode }) {
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
        className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
      />
      <Button type="submit" variant="accent" disabled={busy || !email.trim()}>
        {busy ? 'Sending…' : 'Send request'}
      </Button>
      {msg && (
        <p className={cn('text-xs', msg.kind === 'ok' ? 'text-success' : 'text-danger')}>{msg.text}</p>
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
