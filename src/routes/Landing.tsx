import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Island, Popover, IconButton } from '@/components/primitives'
import { SettingsIcon, GoogleIcon } from '@/components/icons'
import { SettingsDialog } from '@/islands/Settings'
import { SetupStatusButton, SetupBanner } from '@/islands/SetupStatus'
import { authEnabled } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'

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
  const [settingsOpen, setSettingsOpen] = useState(false)

  function go(target: string) {
    const slug = target.trim().toLowerCase().replace(/\s+/g, '-')
    if (slug) navigate(`/r/${encodeURIComponent(slug)}`)
  }

  function onJoin(e: FormEvent) {
    e.preventDefault()
    go(room)
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-4">
      <header className="absolute inset-x-4 top-4 flex items-center justify-between">
        {authEnabled ? <AccountMenu /> : <span />}
        <div className="flex items-center gap-2">
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

      <SetupBanner />

      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-control bg-accent text-accent-ink font-bold">
          M
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Manim</h1>
      </div>

      <Island pad="lg" className="w-full max-w-md">
        <h2 className="text-lg font-semibold">Start or join a call</h2>
        <p className="mt-1 text-sm text-ink-muted">Free, secure, lightweight video.</p>

        <form onSubmit={onJoin} className="mt-5 flex flex-col gap-3">
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
      </Island>

      <p className="text-xs text-ink-subtle">No download. Works in your browser.</p>
    </main>
  )
}

/** Email magic-link sign-in / sign-out. Signing in gives a cross-device identity. */
function AccountMenu() {
  const signedIn = useAuthStore((s) => s.signedIn)
  const email = useAuthStore((s) => s.email)
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
        <Button variant="ghost" size="sm">
          {signedIn ? (email ?? 'Account') : 'Sign in'}
        </Button>
      }
    >
      {signedIn ? (
        <div className="flex w-56 flex-col gap-2 p-1">
          <p className="truncate px-2 py-1 text-sm text-ink-muted">{email}</p>
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
