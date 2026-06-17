import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Island, Popover, IconButton, Avatar } from '@/components/primitives'
import { SettingsIcon, GoogleIcon, CameraIcon, PeopleIcon } from '@/components/icons'
import { SettingsDialog } from '@/islands/Settings'
import { ContactsDialog } from '@/islands/Contacts'
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

const HERO_FEATURES = ['No download', 'End-to-end ready', 'Free to use']

export function Landing() {
  const navigate = useNavigate()
  const [room, setRoom] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [contactsOpen, setContactsOpen] = useState(false)
  const signedIn = useAuthStore((s) => s.signedIn)
  const myName = useAppStore((s) => s.displayName)
  const addInvite = useInviteStore((s) => s.addInvite)

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
    setContactsOpen(false)
    go(target)
  }

  return (
    // Top-align + scroll on phones so the keyboard can't bury the Join button
    // (centering strands it behind the keyboard); centered on desktop. The hero's
    // verbose copy is desktop-only so the mobile surface stays single-screen.
    <main className="relative min-h-dvh overflow-y-auto p-4 pt-20 sm:pt-4 flex flex-col items-center justify-start lg:justify-center">
      <GlowBackground />

      <header className="absolute inset-x-4 top-4 z-20 flex items-center justify-between">
        {authEnabled ? <AccountMenu /> : <span />}
        <div className="flex items-center gap-2">
          {signedIn && (
            <IconButton
              label="Contacts"
              icon={<PeopleIcon />}
              tone="neutral"
              onClick={() => setContactsOpen(true)}
            />
          )}
          <SetupStatusButton />
          <IconButton
            label="Settings"
            icon={<SettingsIcon />}
            tone="neutral"
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ContactsDialog open={contactsOpen} onOpenChange={setContactsOpen} onCall={callContact} />

      <div className="relative z-10 grid w-full max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-14">
        {/* Hero — full copy on desktop, compact brand + headline on mobile. */}
        <div className="text-center lg:text-left">
          <div className="flex items-center justify-center gap-2.5 lg:justify-start">
            <span className="grid size-9 place-items-center rounded-control bg-accent text-accent-ink font-bold">
              M
            </span>
            <span className="text-xl font-semibold tracking-tight">Manim</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:mt-6 sm:text-3xl lg:text-5xl lg:leading-[1.05]">
            Video calls, <span className="text-accent">lightweight</span> and secure.
          </h1>
          <p className="mx-auto mt-3 hidden max-w-md text-base text-ink-muted lg:mx-0 lg:block">
            Start or join a room in a single click — no downloads, no accounts required.
            End-to-end encryption is one toggle away when the conversation matters.
          </p>
          <ul className="mt-6 hidden flex-wrap gap-2 lg:flex">
            {HERO_FEATURES.map((f) => (
              <li
                key={f}
                className="rounded-control bg-accent-soft px-3 py-1 text-xs font-medium text-accent"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Action column — contextual cards stacked above the join card. */}
        <div className="flex w-full max-w-md flex-col gap-4 justify-self-center lg:justify-self-end">
          <SetupBanner />
          <OtherDeviceMeetings onJoin={go} />

          <Island pad="none" className="w-full p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Start or join a call</h2>
            <p className="mt-1 text-sm text-ink-muted">Free, secure, lightweight video.</p>

            <form onSubmit={onJoin} className="mt-4 flex flex-col gap-3 sm:mt-5">
              <label htmlFor="room" className="text-sm font-medium">
                Room name or code
              </label>
              <input
                id="room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="e.g. team-standup"
                autoComplete="off"
                className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="accent" block disabled={!room.trim()}>
                  Join room
                </Button>
                <Button type="button" variant="neutral" onClick={() => go(randomRoom())}>
                  New call
                </Button>
              </div>
            </form>

            <p className="mt-4 text-center text-xs text-ink-subtle">
              No download. Works in your browser.
            </p>
          </Island>
        </div>
      </div>
    </main>
  )
}

/** Ambient accent glow behind the hero — pure CSS, theme-aware (accent tokens). */
function GlowBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <div
        className="absolute -left-24 top-1/4 size-[34rem] rounded-full opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-accent-soft), transparent)' }}
      />
      <div
        className="absolute -right-32 bottom-0 size-[30rem] rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-accent-soft), transparent)' }}
      />
    </div>
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
              className="h-9 rounded-field bg-sunken px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
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
