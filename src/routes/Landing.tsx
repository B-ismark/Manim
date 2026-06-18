import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Island, Popover, Avatar } from '@/components/primitives'
import { GoogleIcon, CameraIcon } from '@/components/icons'
import { SettingsPopover } from '@/islands/Settings'
import { ContactsPopover } from '@/islands/Contacts'
import { SetupStatusButton, SetupBanner } from '@/islands/SetupStatus'
import { authEnabled } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import { useInviteStore } from '@/store/useInviteStore'
import { toast } from '@/store/useToastStore'
import { ringUser } from '@/features/calls/calls'
import { useOtherDeviceMeetings } from '@/features/calls/usePresence'
import { prettyRoom } from '@/lib/roomName'
import type { ContactRow } from '@/store/useContactsStore'

function randomRoom(): string {
  // friendly, readable room code
  const a = ['calm', 'swift', 'bright', 'quiet', 'lunar', 'amber', 'jade', 'cobalt']
  const b = ['otter', 'falcon', 'maple', 'harbor', 'comet', 'willow', 'cedar', 'delta']
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]
  return `${pick(a)}-${pick(b)}-${Math.floor(100 + Math.random() * 900)}`
}

export function Landing() {
  const navigate = useNavigate()
  const [room, setRoom] = useState('')
  const signedIn = useAuthStore((s) => s.signedIn)
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const myName = useAppStore((s) => s.displayName)
  const addInvite = useInviteStore((s) => s.addInvite)
  const firstName = myName.trim().split(/\s+/)[0]

  function go(target: string) {
    const slug = target.trim().toLowerCase().replace(/\s+/g, '-')
    if (slug) navigate(`/r/${encodeURIComponent(slug)}`)
  }

  function onJoin(e: FormEvent) {
    e.preventDefault()
    go(room)
  }

  // Call a contact: use the typed meeting name (or a random room), ring them in,
  // register a "waiting for them to join" hint, and join ourselves.
  function callContact(c: ContactRow, roomName: string) {
    if (!c.email) return
    const slug = roomName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    const target = slug || randomRoom()
    void ringUser(c.email, target, myName || 'Someone')
    // Shows an "Invited · waiting" row in the in-call People panel; it clears when
    // they join (their display name matches), so it doubles as a waiting indicator.
    addInvite(c.name)
    toast(`Ringing ${c.name}…`, 'info')
    go(target)
  }

  return (
    // Top-align + scroll on phones so the keyboard can't bury the inputs
    // (centering strands them behind the keyboard); centered on desktop.
    <main className="min-h-dvh overflow-y-auto p-4 pt-20 sm:pt-4 flex flex-col items-center justify-start sm:justify-center">
      <header className="absolute inset-x-4 top-4 z-20 flex items-center justify-between">
        {authEnabled ? <AccountMenu /> : <span />}
        <div className="flex items-center gap-2">
          {signedIn && <ContactsPopover onCall={callContact} />}
          <SetupStatusButton />
          <SettingsPopover />
        </div>
      </header>

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {/* Personal greeting when signed in (Whereby-style), else just the brand. */}
        {signedIn ? (
          <div className="flex flex-col items-center gap-3">
            <Avatar size="lg" name={myName || '?'} src={avatarUrl} />
            <h1 className="text-xl font-semibold tracking-tight">
              {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
            </h1>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-control bg-accent text-accent-ink font-bold">
              M
            </span>
            <h1 className="text-xl font-semibold tracking-tight">Manim</h1>
          </div>
        )}

        <SetupBanner />
        <OtherDeviceMeetings onJoin={go} />

        <Island pad="none" className="w-full p-5 sm:p-6">
          <form onSubmit={onJoin} className="flex flex-col gap-3">
            <label htmlFor="room" className="text-sm font-medium">
              Meeting name or code
            </label>
            {/* text-base on mobile keeps the font ≥16px so iOS doesn't zoom on focus. */}
            <input
              id="room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. team-standup"
              autoComplete="off"
              className="h-11 w-full rounded-field bg-sunken px-3.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
            />
            <div className="flex gap-2">
              {/* New meeting: uses the typed name, or a random room when blank. */}
              <Button
                type="button"
                variant="accent"
                block
                onClick={() => go(room.trim() || randomRoom())}
              >
                <CameraIcon />
                New meeting
              </Button>
              <Button type="submit" variant="neutral" disabled={!room.trim()}>
                Join
              </Button>
            </div>
          </form>
        </Island>
      </div>
    </main>
  )
}

/** Quick-join meetings the signed-in user already has open on another device. */
function OtherDeviceMeetings({ onJoin }: { onJoin: (room: string) => void }) {
  const meetings = useOtherDeviceMeetings()
  if (meetings.length === 0) return null
  return (
    <Island pad="none" className="w-full p-3">
      <p className="px-1 pb-1.5 text-xs font-medium text-ink-subtle">On your other devices</p>
      <ul className="flex flex-col gap-1.5">
        {meetings.map((m) => (
          <li key={m.room} className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent-soft text-accent [&_svg]:size-4">
              <CameraIcon />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{prettyRoom(m.room)}</span>
            <Button variant="accent" size="sm" onClick={() => onJoin(m.room)}>
              Join
            </Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}

/** Email magic-link sign-in / sign-out. Signing in gives a cross-device identity. */
function AccountMenu() {
  const signedIn = useAuthStore((s) => s.signedIn)
  const email = useAuthStore((s) => s.email)
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const name = useAppStore((s) => s.displayName)
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const signOut = useAuthStore((s) => s.signOut)
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function google() {
    setErr(null)
    try {
      await signInWithGoogle()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Google sign-in failed')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      await signInWithEmail(value.trim())
      setSent(true)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Sign-in failed')
    }
  }

  return (
    <Popover
      side="bottom"
      align="start"
      trigger={
        signedIn ? (
          <button
            type="button"
            aria-label="Account"
            className="flex items-center gap-2 rounded-control p-1 pr-2.5 text-sm hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar size="sm" name={name || email || '?'} src={avatarUrl} />
            <span className="hidden max-w-[12rem] truncate font-medium sm:inline">
              {name || email}
            </span>
          </button>
        ) : (
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        )
      }
    >
      {signedIn ? (
        <div className="flex w-60 flex-col gap-2 p-1">
          <div className="flex items-center gap-2.5 px-1 py-1">
            <Avatar size="sm" name={name || email || '?'} src={avatarUrl} />
            <div className="min-w-0">
              {name && <p className="truncate text-sm font-medium">{name}</p>}
              <p className="truncate text-xs text-ink-muted">{email}</p>
            </div>
          </div>
          <Button variant="neutral" size="sm" block onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      ) : sent ? (
        <p className="w-64 p-2 text-sm text-ink-muted">Check your email for a sign-in link.</p>
      ) : (
        <div className="flex w-64 flex-col gap-2 p-1">
          <Button variant="neutral" size="sm" block onClick={() => void google()}>
            <GoogleIcon className="size-4" />
            Continue with Google
          </Button>
          <div className="flex items-center gap-2 py-0.5 text-xs text-ink-subtle">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <input
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email"
              autoComplete="email"
              className="h-9 rounded-field bg-sunken px-3 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
            />
            <Button type="submit" variant="accent" size="sm" disabled={!value.trim()}>
              Send magic link
            </Button>
          </form>
          {err && <p className="text-xs text-danger">{err}</p>}
          <p className="text-xs text-ink-subtle">Sign in to move calls between your devices.</p>
        </div>
      )}
    </Popover>
  )
}
