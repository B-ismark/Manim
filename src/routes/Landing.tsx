import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, Island, Popover, Avatar } from '@/components/primitives'
import { GoogleIcon, CameraIcon, CloseIcon } from '@/components/icons'
import { SettingsLauncher } from '@/islands/Settings'
import { ContactsLauncher } from '@/islands/Contacts'
import { SetupStatusButton, SetupBanner } from '@/islands/SetupStatus'
import { SiteFooter } from '@/islands/SiteFooter'
import { authEnabled } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import { useInviteStore } from '@/store/useInviteStore'
import { useRecentRoomsStore } from '@/store/useRecentRoomsStore'
import { toast } from '@/store/useToastStore'
import { getMe } from '@/lib/orchestrator'
import { supabase } from '@/lib/supabase'
import { ringUser } from '@/features/calls/calls'
import { useOtherDeviceMeetings } from '@/features/calls/usePresence'
import { prettyRoom } from '@/lib/roomName'
import { newRoomSecrets, parseRoomHash, roomTo, type RoomSecrets } from '@/lib/roomLink'
import type { ContactRow } from '@/store/useContactsStore'

// Unambiguous base32-ish alphabet (no 0/o/1/l/i) for the random suffix.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * Friendly two-word prefix for recognizability, plus a CSPRNG suffix carrying the
 * real entropy. The room slug is the access credential (no separate join secret
 * yet), so it must be unguessable: 13 chars over a 31-symbol alphabet ≈ 64 bits,
 * generated with crypto.getRandomValues (NOT Math.random, which is predictable).
 * Combined with the per-IP knock rate limit, this kills enumeration.
 */
function randomRoom(): string {
  const a = ['calm', 'swift', 'bright', 'quiet', 'lunar', 'amber', 'jade', 'cobalt']
  const b = ['otter', 'falcon', 'maple', 'harbor', 'comet', 'willow', 'cedar', 'delta']
  const bytes = crypto.getRandomValues(new Uint8Array(13 + 2))
  const pick = (arr: string[], i: number) => arr[bytes[i] % arr.length]
  let suffix = ''
  for (let i = 0; i < 13; i++) suffix += CODE_ALPHABET[bytes[i + 2] % CODE_ALPHABET.length]
  return `${pick(a, 0)}-${pick(b, 1)}-${suffix}`
}

/** URL-safe room slug: lowercase, whitespace→dash, strip anything that would
 *  corrupt the path segment or the #fragment where invite secrets ride. */
function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function Landing() {
  const navigate = useNavigate()
  const [room, setRoom] = useState('')
  const signedIn = useAuthStore((s) => s.signedIn)
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const myName = useAppStore((s) => s.displayName)
  const addInvite = useInviteStore((s) => s.addInvite)
  const firstName = myName.trim().split(/\s+/)[0]

  // Beta gate state, per THIS user: is the gate on, and may they host? Drives the
  // up-front "private beta" notice (so a guest learns hosting needs an approved
  // account here, not after a failed knock) and hides it for an approved host.
  // Re-checked on sign-in/out. Defaults to can-host so the UI never falsely blocks
  // before the probe resolves.
  const [betaGate, setBetaGate] = useState(false)
  const [canHost, setCanHost] = useState(true)
  // Ref mirrors of the two flags above: readable AFTER an await (closure-captured
  // state would be stale once newMeeting resumes past its probe await).
  const gateRef = useRef({ betaGate: false, canHost: true })
  // The in-flight probe, so a fast "New meeting" tap can await it instead of
  // racing past the gate on the optimistic can-host default.
  const betaProbe = useRef<Promise<void> | null>(null)
  useEffect(() => {
    let alive = true
    const probe = (async () => {
      const token = signedIn
        ? (await supabase?.auth.getSession())?.data.session?.access_token
        : undefined
      const me = await getMe(token)
      if (!alive) return
      setBetaGate(me.betaGate)
      setCanHost(me.allowed)
      gateRef.current = { betaGate: me.betaGate, canHost: me.allowed }
    })()
    betaProbe.current = probe
    return () => {
      alive = false
    }
  }, [signedIn])

  /** Navigate to a room, carrying any join-secret / E2EE key in the #fragment. */
  function goTo(slug: string, secrets: RoomSecrets = {}) {
    if (slug) navigate(roomTo(slug, secrets))
  }

  // A typed value is usually a bare meeting name, but may be a pasted invite link
  // (which carries its own secrets in the #fragment) — handle both. Both branches
  // pass through toSlug: `/ ? # %` in a typed name used to flow into the URL and
  // corrupt the fragment encoding of the generated invite link.
  function parseTyped(value: string): { slug: string; secrets: RoomSecrets } {
    const v = value.trim()
    const m = v.match(/\/r\/([^/?#]+)(#.*)?$/)
    if (m) {
      let raw = m[1]
      try {
        raw = decodeURIComponent(raw)
      } catch {
        /* malformed escape — use the raw segment */
      }
      return { slug: toSlug(raw), secrets: parseRoomHash(m[2] || '') }
    }
    return { slug: toSlug(v), secrets: {} }
  }

  // Join an EXISTING room by name/link: a typed name joins an open room as-is; a
  // pasted link carries its secret. No fresh secret minted (that would make a new,
  // different room).
  function onJoin(e: FormEvent) {
    e.preventDefault()
    const { slug, secrets } = parseTyped(room)
    if (!slug) {
      // Everything stripped (e.g. "???") — say why instead of a silent no-op.
      if (room.trim()) toast('Meeting names need letters or numbers', 'warning')
      return
    }
    goTo(slug, secrets)
  }

  // New meeting: mint a fresh join secret + E2EE key so the shareable link is an
  // unguessable, end-to-end-encrypted room. A pasted link keeps its own secrets; a
  // blank field gets a random room name.
  async function newMeeting() {
    const typed = room.trim()
    // A fast tap can beat the beta probe: wait for it (once) so the gate reads
    // the real answer instead of the optimistic default — otherwise a
    // non-approved user slips through here and dead-ends on the in-room
    // "invite-only" error card.
    try {
      await betaProbe.current
    } catch {
      /* probe failed — fall through with whatever state we have */
    }
    const parsed = typed ? parseTyped(typed) : { slug: '', secrets: {} as RoomSecrets }
    // Starting a NEW room makes you its host — which the beta gate restricts to
    // approved accounts. Stop a user who can't host before they dead-end on the
    // in-room "invite-only" error. A pasted invite link (carries a secret) is a guest
    // JOIN, not a host claim, so it's always allowed through.
    const { betaGate: gated, canHost: allowed } = gateRef.current
    if (gated && !allowed && !parsed.secrets.secret) {
      toast(
        signedIn
          ? 'Your account isn’t approved to start meetings yet.'
          : 'Sign in with an approved account to start a meeting',
        'warning',
      )
      return
    }
    if (!typed) return goTo(randomRoom(), newRoomSecrets())
    // Typed only symbols → slug came back empty: mint a random room rather than
    // silently doing nothing.
    goTo(parsed.slug || randomRoom(), parsed.secrets.secret ? parsed.secrets : newRoomSecrets())
  }

  // Call a contact: mint a fresh secured room, ring them into it (the ring carries
  // the secrets so they can pass the join gate), register a "waiting" hint, join.
  function callContact(c: ContactRow, roomName: string) {
    if (!c.email) return
    const slug =
      roomName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || randomRoom()
    const secrets = newRoomSecrets()
    void ringUser(c.email, slug, myName || 'Someone', secrets)
    // Shows an "Invited · waiting" row in the in-call People panel; it clears when
    // they join (their display name matches), so it doubles as a waiting indicator.
    addInvite(c.name)
    toast(`Ringing ${c.name}…`, 'info')
    goTo(slug, secrets)
  }

  return (
    // Top-align + scroll on phones so the keyboard can't bury the inputs
    // (centering strands them behind the keyboard); centered on desktop.
    <main className="min-h-dvh overflow-y-auto p-4 pt-20 sm:pt-4 short:pt-4 flex flex-col items-center justify-start sm:justify-center">
      {/* Fixed (not absolute): the page scrolls on phones, and account/settings
          must stay reachable while scrolled. */}
      <header className="fixed inset-x-4 top-4 z-20 flex items-center justify-between">
        {authEnabled ? <AccountMenu /> : <span />}
        <div className="flex items-center gap-2">
          {signedIn && <ContactsLauncher onCall={callContact} />}
          <SetupStatusButton />
          <SettingsLauncher />
        </div>
      </header>

      <div className="flex w-full max-w-sm flex-col items-center gap-6 short:gap-3">
        {/* Personal greeting when signed in (Whereby-style), else just the brand. */}
        {signedIn ? (
          <div className="flex flex-col items-center gap-3 short:gap-1.5">
            <Avatar size="lg" name={myName || '?'} src={avatarUrl} />
            <h1 className="text-xl font-semibold tracking-tight short:text-lg">
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
        {betaGate && !canHost && (
          <Island elevation="pop" pad="sm" bordered className="w-full border-accent/40">
            <div className="flex items-start gap-3">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Manim is in private beta</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {signedIn
                    ? 'Your account isn’t approved to start meetings yet. You can still join any call you’re invited to.'
                    : 'Sign in with an approved account to start a meeting — or open an invite link to join one.'}
                </p>
              </div>
            </div>
          </Island>
        )}
        {signedIn && <LiveAndRecent onJoin={goTo} />}

        <Island pad="none" className="w-full p-5 sm:p-6 short:p-4">
          {/* Two actions that are NOT variations of each other, laid out so you can
              see that without being told.

              They used to sit shoulder to shoulder under the field — same row, same
              pill shape, one accent and one grey — which reads as one action and its
              understudy. They aren't: Join enters a room that already exists and
              mints nothing, while New meeting mints a fresh join secret and E2EE key,
              so for the SAME typed name the two produce different, mutually
              inaccessible rooms.

              So Join is welded to the field it consumes — one row, matched heights,
              the shape every "enter a code" control has (Meet, Zoom, Teams) — and
              New meeting is a full-width button on its own line. Grouping does the
              explaining; no helper text needed, and none added. New meeting is still
              the primary despite coming second: it is the widest, loudest thing in
              the card, which is how Whereby and Jitsi order the same pair. */}
          <form onSubmit={onJoin} className="flex flex-col gap-3 short:gap-2">
            <label htmlFor="room" className="text-sm font-medium">
              Meeting name or code
            </label>
            <div className="flex gap-2">
              {/* text-base on mobile keeps the font ≥16px so iOS doesn't zoom on focus. */}
              <input
                id="room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="e.g. team-standup"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-field bg-sunken px-3.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
              />
              {/* h-11 to match the input exactly — a button a notch shorter than the
                  field it sits beside stops reading as part of it. */}
              <Button type="submit" variant="neutral" className="h-11" disabled={!room.trim()}>
                Join
              </Button>
            </div>
            {/* Uses the typed name, or a random room when blank. */}
            <Button type="button" variant="accent" block onClick={newMeeting}>
              <CameraIcon />
              New meeting
            </Button>
          </form>
        </Island>
      </div>

      <SiteFooter />
    </main>
  )
}

/**
 * The two quick-join lists, sharing one presence read so they can't double-list the
 * same room: a call live on another device shows ONLY under "On your other devices"
 * (live, actionable now), and is suppressed from "Recent calls" (where it'd be a
 * stale duplicate). Recents still shows everything else from this device's history.
 */
function LiveAndRecent({ onJoin }: { onJoin: (room: string, secrets: RoomSecrets) => void }) {
  const meetings = useOtherDeviceMeetings()
  const activeSlugs = new Set(meetings.map((m) => m.room))
  return (
    <>
      <OtherDeviceMeetings meetings={meetings} onJoin={onJoin} />
      <RecentMeetings hideSlugs={activeSlugs} onJoin={onJoin} />
    </>
  )
}

/** Quick-join meetings the signed-in user already has open on another device. */
function OtherDeviceMeetings({
  meetings,
  onJoin,
}: {
  meetings: ReturnType<typeof useOtherDeviceMeetings>
  onJoin: (room: string, secrets: RoomSecrets) => void
}) {
  if (meetings.length === 0) return null
  return (
    <Island pad="none" className="w-full p-3">
      <p className="px-1 pb-1.5 text-xs font-medium text-ink-subtle">On your other devices</p>
      <ul className="flex flex-col gap-1.5">
        {meetings.map((m) => (
          <li key={m.room} className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text [&_svg]:size-4">
              <CameraIcon />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{prettyRoom(m.room)}</span>
            <Button variant="accent" size="sm" onClick={() => onJoin(m.room, { secret: m.secret, e2ee: m.e2ee })}>
              Join
            </Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}

/** Rejoin a recently-exited meeting (stored locally). Mirrors OtherDeviceMeetings,
 *  but sourced from this device's history rather than live presence. */
function RecentMeetings({
  hideSlugs,
  onJoin,
}: {
  hideSlugs: Set<string>
  onJoin: (room: string, secrets: RoomSecrets) => void
}) {
  const allRooms = useRecentRoomsStore((s) => s.rooms)
  const remove = useRecentRoomsStore((s) => s.remove)
  // Drop any room that's live on another device — it's already offered above as a
  // "Join" (active), so listing it here too as "Rejoin" (stale) is just a duplicate.
  const rooms = allRooms.filter((r) => !hideSlugs.has(r.slug))
  if (rooms.length === 0) return null
  return (
    <Island pad="none" className="w-full p-3">
      <p className="px-1 pb-1.5 text-xs font-medium text-ink-subtle">Recent calls</p>
      <ul className="flex flex-col gap-1.5">
        {rooms.map((r) => (
          <li key={r.slug} className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-control bg-sunken text-ink-muted [&_svg]:size-4">
              <CameraIcon />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
            {/* Secondary, deliberately — `neutral`, not `accent`.
                The recents list is the one place on this page that repeats a button
                per ROW, so an accent fill here doesn't read as "the important
                action", it reads as a column of them: three or four saturated pills
                stacked directly above "New meeting", each louder than the page's
                actual primary CTA and none of them more urgent than the last call
                you happened to leave. Emphasis has to be scarce to mean anything.

                The rule this settles, for the whole page: `accent` is for STARTING
                something (New meeting) and for a call that is LIVE right now (the
                other-devices list above — one row, time-sensitive, and usually
                absent). Re-entering something from history is `neutral`, which is
                already what the form's own Join button uses, so every "go to a room
                that already exists" control now looks the same. The row's remove ✕
                stays a bare icon below both. */}
            <Button
              variant="neutral"
              size="sm"
              onClick={() => onJoin(r.slug, { secret: r.secret, e2ee: r.e2ee })}
            >
              Rejoin
            </Button>
            <button
              type="button"
              aria-label={`Remove ${r.name} from recents`}
              onClick={() => remove(r.slug)}
              className="grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-3.5"
            >
              <CloseIcon />
            </button>
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
  const signOut = useAuthStore((s) => s.signOut)

  // Signed out → the sign-in flow lives in a modal (see SignIn). Signed in → a
  // small account popover; there's no leave-and-return step here, so a transient
  // anchored panel is fine.
  if (!signedIn) return <SignIn />

  return (
    <Popover
      side="bottom"
      align="start"
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="flex items-center gap-2 rounded-control p-1 pr-2.5 text-sm hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar size="sm" name={name || email || '?'} src={avatarUrl} />
          <span className="hidden max-w-[12rem] truncate font-medium sm:inline">{name || email}</span>
        </button>
      }
    >
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
    </Popover>
  )
}

/**
 * Signed-out sign-in, in a MODAL dialog (not a popover). Reading the emailed code
 * means switching to the mail app / another tab — a popover dismisses on that blur
 * and would lose the code field + the email you typed, forcing a re-request (and
 * the 60s SMTP throttle bites). A modal stays put across the switch, so you return
 * to the same form. That persistence is the whole point of the code path. State is
 * kept even across a deliberate close, so reopening resumes where you left off.
 * Signing in flips `signedIn`, which unmounts this and shows the account menu.
 */
function SignIn() {
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
  const verifyEmailOtp = useAuthStore((s) => s.verifyEmailOtp)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Resend cooldown (s). Brevo's SMTP throttle is 60s/recipient — surfacing the
  // countdown turns the silent "rate-limited" failure into an obvious wait.
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

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
      setCooldown(60)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Sign-in failed')
    }
  }

  async function resend() {
    if (cooldown > 0) return
    setErr(null)
    setCode('')
    try {
      await signInWithEmail(value.trim())
      setCooldown(60)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not resend')
    }
  }

  // Code path: paste the code from the email. On success onAuthStateChange flips
  // signedIn and this whole component unmounts (→ the account menu).
  async function verify(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setVerifying(true)
    try {
      await verifyEmailOtp(value.trim(), code.trim())
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "That code didn't work — check it and try again.")
    } finally {
      setVerifying(false)
    }
  }

  function backToEmail() {
    setSent(false)
    setCode('')
    setErr(null)
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Sign in
      </Button>
      {/* Auth modal: centered, narrow column (Mobbin convention — Confluence /
          ClassDojo / sweetgreen). The shared Dialog defaults to 32rem (too wide for
          a single column), so override to ~26rem; hideTitle because we render our
          own centered icon + heading. */}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={sent ? 'Check your email' : 'Sign in'}
        hideTitle
        className="!w-[min(92vw,26rem)] lg:!w-[min(90vw,26rem)]"
      >
        <div className="flex flex-col items-center gap-5 pb-1 pt-2 text-center">
          {/* Header glyph: brand mark for the entry step, an envelope once sent. */}
          <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text [&_svg]:size-6">
            {sent ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="m3.5 7 8.5 6 8.5-6" />
              </svg>
            ) : (
              <span className="text-xl font-bold">M</span>
            )}
          </span>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              {sent ? 'Check your email' : 'Sign in to Manim'}
            </h2>
            <p className="text-sm text-ink-muted">
              {sent ? (
                <>
                  Enter the code we sent to <span className="font-medium text-ink">{value}</span>.
                </>
              ) : (
                'Sync your calls and contacts across devices.'
              )}
            </p>
          </div>

          {sent ? (
            <div className="flex w-full flex-col gap-3">
              {/* Single, length-agnostic field — Supabase's OTP length is configurable
                  (6–10); a fixed 6-box segmented input would truncate an 8-digit code. */}
              <form onSubmit={verify} className="flex flex-col gap-2.5">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="••••••"
                  aria-label="Verification code"
                  className="h-12 rounded-field bg-sunken text-center font-mono text-xl tracking-[0.4em] outline-none placeholder:tracking-[0.3em] placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button type="submit" variant="accent" block disabled={code.length < 6 || verifying}>
                  {verifying ? 'Verifying…' : 'Verify code'}
                </Button>
              </form>

              {err && <p className="text-sm text-danger-text">{err}</p>}

              <p className="text-sm text-ink-muted">
                Didn't get it?{' '}
                <button
                  type="button"
                  onClick={() => void resend()}
                  disabled={cooldown > 0}
                  className="font-medium text-accent hover:text-accent-hover disabled:cursor-default disabled:text-ink-subtle disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </p>

              <button
                type="button"
                onClick={backToEmail}
                className="text-xs text-ink-subtle underline underline-offset-2 hover:text-ink"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <div className="flex w-full flex-col gap-3">
              <Button variant="neutral" block onClick={() => void google()}>
                <GoogleIcon className="size-4" />
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-ink-subtle">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
              <form onSubmit={submit} className="flex flex-col gap-2.5">
                <input
                  type="email"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="you@email.com"
                  aria-label="Email"
                  autoComplete="email"
                  className="h-12 rounded-field bg-sunken px-3.5 text-center text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button type="submit" variant="accent" block disabled={!value.trim()}>
                  Continue with email
                </Button>
              </form>
              {err && <p className="text-sm text-danger-text">{err}</p>}
              <p className="text-xs text-ink-subtle">
                We'll email a sign-in link and a code. No password needed.
              </p>
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
