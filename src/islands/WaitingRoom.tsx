import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Avatar, Button, IconButton } from '@/components/primitives'
import { CameraIcon, CameraOffIcon } from '@/components/icons'
import { useAppStore, rememberPrejoin } from '@/store/useAppStore'
import { MAX_NAME_LEN } from '@/lib/displayName'
import { MAX_NOTE_LEN, updateKnock, ApiError } from '@/lib/orchestrator'
import { prettyRoom } from '@/lib/roomName'
import { formatElapsed, useElapsed } from '@/lib/connectionTrouble'
import { cn } from '@/lib/cn'

/**
 * The "waiting to be let in" lobby. Not a dead end: you see yourself as the
 * host will (camera on or off, fixable here), can correct the name the host
 * will be asked to admit, and can leave the host a one-line note ("Ama from
 * the design team"), all while the request stays in the queue (Meet and Zoom
 * both keep your preview up while you wait).
 *
 * It wears the join screen's frame, like the end page: eyebrow and call name at
 * the top-left, the buttons under the thumb on a phone.
 *
 * On a phone the guest is likely to switch apps while waiting, so it also offers
 * a one-tap opt-in for an OS notification when admitted (RoomRoute's poll fires
 * it when the tab is hidden). The permission request is gesture-driven.
 */
export function WaitingRoom({
  room,
  requestId,
  claim,
  onCancel,
}: {
  room: string
  requestId: string
  claim: string
  onCancel: () => void
}) {
  const since = useRef(Date.now()).current
  const waited = useElapsed(since)
  const name = useAppStore((s) => s.displayName)
  const setDisplayName = useAppStore((s) => s.setDisplayName)

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] md:justify-center">
      <div className="flex w-full max-w-md flex-1 flex-col md:flex-none">
        <header className="px-1 pt-4 md:pt-0">
          <p className="text-xs font-medium text-ink-subtle">Waiting to be let in</p>
          <h1 className="truncate text-2xl font-semibold leading-tight">{prettyRoom(room)}</h1>
        </header>
        <section className="mt-4 rounded-island bg-surface p-3 shadow-raised">
          <SelfView name={name} />
          <p role="status" className="mt-3 flex items-center gap-2 px-1 text-sm text-ink-muted">
            <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
            <span className="min-w-0 flex-1">The host knows you’re here</span>
            <span aria-hidden className="tabular-nums text-ink-subtle">
              {formatElapsed(waited)}
            </span>
          </p>
          <div className="mt-2 divide-y divide-line border-t border-line">
            <NameRow
              name={name}
              save={async (next) => {
                const r = await updateKnock({ room, requestId, claim, name: next })
                // The name the host admits is the name you'll have in the call.
                setDisplayName(r.name)
              }}
            />
            <NoteRow save={async (note) => (await updateKnock({ room, requestId, claim, note })).note} />
          </div>
        </section>
        <div className="mt-auto flex flex-col gap-2 pt-5 md:mt-5 md:pt-0">
          <NotifyMe />
          <Button variant="neutral" size="lg" block onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </main>
  )
}

/**
 * You, as you'll arrive. The camera follows the join screen's choice, and the
 * toggle here changes that choice (so what you see is what the call gets).
 */
function SelfView({ name }: { name: string }) {
  const cameraOn = useAppStore((s) => s.prejoin.cameraEnabled)
  const setPrejoin = useAppStore((s) => s.setPrejoin)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [mirror, setMirror] = useState(true)

  useEffect(() => {
    if (!cameraOn || !navigator.mediaDevices?.getUserMedia) return
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        setFailed(false)
        setMirror(s.getVideoTracks()[0]?.getSettings().facingMode !== 'environment')
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraOn])

  const showVideo = cameraOn && !failed
  const toggle = () => {
    const next = !cameraOn
    setPrejoin({ cameraEnabled: next })
    rememberPrejoin({ cameraEnabled: next })
  }
  return (
    <div className="relative aspect-[4/3] max-h-[34dvh] w-full overflow-hidden rounded-2xl bg-stage md:max-h-none md:aspect-video">
      {showVideo ? (
        <video
          ref={videoRef}
          data-testid="waiting-preview"
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          className={cn('size-full object-cover', mirror && '[transform:scaleX(-1)]')}
        />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar name={name} size="lg" />
        </div>
      )}
      <span
        dir="auto"
        className="absolute bottom-2 left-2 max-w-[calc(100%-4.5rem)] truncate rounded-full bg-scrim px-2.5 py-1 text-xs font-medium text-white"
      >
        {name}
        {failed && cameraOn ? ' · camera unavailable' : ''}
      </span>
      <IconButton
        label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        icon={cameraOn ? <CameraIcon /> : <CameraOffIcon />}
        tone="neutral"
        className="absolute bottom-2 right-2"
        onClick={toggle}
      />
    </div>
  )
}

/** One row of the card: a label, what it's set to, and a way to change it. */
function Row({ label, value, action }: { label: string; value: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-1 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-subtle">{label}</p>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
      {action}
    </div>
  )
}

/** A one-line edit in place of a row: field, Save, and Cancel to back out. */
function InlineEdit({
  label,
  initial,
  maxLength,
  placeholder,
  submitLabel,
  onSave,
  onCancel,
}: {
  label: string
  initial: string
  maxLength: number
  placeholder?: string
  submitLabel: string
  onSave: (v: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(value)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save that. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="px-1 py-2">
      <label className="text-xs text-ink-subtle" htmlFor={`edit-${label}`}>
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={`edit-${label}`}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          dir="auto"
          enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-field bg-sunken px-3 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
        />
        <Button type="submit" variant="accent" className="h-11" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger-text">
          {error}
        </p>
      )}
    </form>
  )
}

function NameRow({ name, save }: { name: string; save: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <InlineEdit
        label="Your name"
        initial={name}
        maxLength={MAX_NAME_LEN}
        submitLabel="Save"
        onSave={async (v) => {
          if (v.trim() && v.trim() !== name) await save(v.trim())
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }
  return (
    <Row
      label="The host will see"
      value={<span dir="auto">{name}</span>}
      action={
        <Button variant="ghost" className="h-11" aria-label="Edit your name" onClick={() => setEditing(true)}>
          Edit
        </Button>
      }
    />
  )
}

function NoteRow({ save }: { save: (note: string) => Promise<string> }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  if (editing) {
    return (
      <InlineEdit
        label="Note for the host"
        initial={note}
        maxLength={MAX_NOTE_LEN}
        placeholder="Who you are, or why you’re here"
        submitLabel="Send"
        onSave={async (v) => {
          if (v.trim() !== note) setNote(await save(v))
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }
  return (
    <Row
      label={note ? 'Your note to the host' : 'Note for the host'}
      value={note ? <span dir="auto">“{note}”</span> : <span className="font-normal text-ink-muted">Optional</span>}
      action={
        <Button
          variant="ghost"
          className="h-11"
          aria-label={note ? 'Edit your note' : 'Add a note for the host'}
          onClick={() => setEditing(true)}
        >
          {note ? 'Edit' : 'Add'}
        </Button>
      }
    />
  )
}

function NotifyMe() {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission>(() => (supported ? Notification.permission : 'denied'))
  if (!supported || perm === 'denied') return null
  if (perm === 'granted') {
    return <p className="pb-1 text-center text-xs text-ink-subtle">We’ll notify you when you’re let in.</p>
  }
  return (
    <Button
      variant="neutral"
      size="lg"
      block
      onClick={async () => {
        try {
          setPerm(await Notification.requestPermission())
        } catch {
          setPerm('denied')
        }
      }}
    >
      Notify me when I’m let in
    </Button>
  )
}
