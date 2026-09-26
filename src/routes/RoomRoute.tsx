import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Island, Button } from '@/components/primitives'
import { LockIcon } from '@/components/icons'
import { roomDeviceId } from '@/lib/roomDevice'
import { takeEnd, type EndReason } from '@/lib/callEnd'
import { PreJoin } from '@/islands/PreJoin'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { useAppStore } from '@/store/useAppStore'
import { useRoomStore } from '@/store/useRoomStore'
import { knock, knockStatus, handoff, LIVEKIT_URL, ApiError } from '@/lib/orchestrator'
import { rememberSeat, seatFor } from '@/lib/seatKeys'
import { getSupabase } from '@/lib/supabase'
import { parseRoomHash, roomHash } from '@/lib/roomLink'
import { forgetRoomSecrets, isAuthFragment, resolveRoomSecrets } from '@/lib/roomKeys'
import { toast } from '@/store/useToastStore'
import { prettyRoom } from '@/lib/roomName'
import { addBreadcrumb, reportError } from '@/lib/report'
import { countUsage, durationRange, joinErrorClass, surface } from '@/lib/usage'

/**
 * Fire a local OS notification when the host admits a *backgrounded* guest. The
 * waiting-room tab is still alive (just hidden), so a foreground Notification +
 * a vibrate is enough — no Web Push / service worker needed. No-op unless the
 * user opted in from the waiting screen (permission granted).
 */
function notifyAdmitted(room: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification("You’re in — open Manim to join", {
      body: `${prettyRoom(room)} is ready for you.`,
      tag: 'mn-admit',
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* some mobile browsers only allow notifications from a service worker — skip */
  }
  try {
    navigator.vibrate?.(200)
  } catch {
    /* unsupported */
  }
}

// The in-call subtree pulls livekit-client + the effects stack (~200KB). Defer it
// to a lazy chunk so the prejoin screen doesn't download it before joining — it
// loads on join (when a token exists). Keep this the ONLY path to that code.
const CallRoom = lazy(() => import('@/islands/CallRoom'))

/**
 * Turn a failed join into something a user can act on. The server's own `error`
 * (an `ApiError` carrying a body) is written as UI copy, so it passes through.
 * Everything else is a LiveKit or browser string — "Client initiated disconnect",
 * "could not createOffer…", "WebSocket error" — meaningless to the person reading
 * it, so the known ones are mapped and the rest get one generic line (the raw text
 * still goes to `reportError`).
 */
function friendlyJoinError(e: unknown, raw: string): string {
  if (e instanceof ApiError && e.fromServer) return raw
  const m = raw.toLowerCase()
  if (m.includes('client initiated') || m.includes('duplicate identity')) {
    return 'Connection closed. Join again to reconnect.'
  }
  if (m.includes('permission') || m.includes('notallowed') || m.includes('denied')) {
    return 'Allow camera and microphone access, then join again.'
  }
  return 'Couldn’t reach the call. Check your connection and join again.'
}

/**
 * A *transient* join failure — a flaky network, a timed-out knock, a dropped
 * fetch — as opposed to a definitive one (denied, duplicate identity, bad room).
 * The in-call path auto-reconnects; only the INITIAL join had no retry (E3), so a
 * mobile user on a spotty connection had to manually re-tap Join. We auto-retry
 * just these classes with a short backoff before falling back to the manual card.
 */
function isTransientJoinError(e: unknown, raw: string): boolean {
  // A gateway error page (502/504, Cloudflare's 52x) has no JSON body: the Worker
  // never answered, so trying again is the right move.
  if (e instanceof ApiError) return !e.fromServer && e.status >= 502
  const m = raw.toLowerCase()
  return (
    m.includes('timeout') ||
    m.includes('could not establish') ||
    m.includes('failed to connect') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network error') ||
    m.includes('load failed')
  )
}

const JOIN_MAX_ATTEMPTS = 3
/** Backoff before retry N (ms): ~0.8s, ~2s. */
const JOIN_BACKOFF_MS = [800, 2000]

const delay = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

export function RoomRoute() {
  const { room = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Room names are lowercase (toSlug), so a hand-typed /r/Team opened a different,
  // empty room from /r/team. Go to the real one, keeping the link's secrets.
  const lowerRoom = room.normalize('NFC').toLowerCase()
  useEffect(() => {
    if (room === lowerRoom) return
    navigate(
      { pathname: `/r/${encodeURIComponent(lowerRoom)}`, search: location.search, hash: location.hash },
      { replace: true, state: location.state },
    )
  }, [room, lowerRoom, navigate, location.search, location.hash, location.state])

  const displayName = useAppStore((s) => s.displayName)
  const deviceId = useAppStore((s) => s.deviceId)
  const prejoin = useAppStore((s) => s.prejoin)
  const setRoomToken = useAppStore((s) => s.setRoomToken)
  const companion = useRoomStore((s) => s.companion)
  const setCompanion = useRoomStore((s) => s.setCompanion)

  // Security material rides in the URL #fragment (see lib/roomLink): the join
  // secret gates server-side entry, the E2EE key keys the media. Both live only in
  // the link, never the path/store.
  //
  // …but a fragment is the most fragile part of a URL, and we were losing it — most
  // damagingly on the round trip through sign-in, which comes back with the
  // provider's own `#access_token=…` where the room's credential used to be. So the
  // link is the AUTHORITY and lib/roomKeys is the memory: whatever the link carries
  // wins and is remembered, and a fragment-less arrival falls back to what this
  // browser saw last time. Read lib/roomKeys before changing any of this.
  const fromLink = useMemo(() => parseRoomHash(location.hash), [location.hash])
  const { secret, e2ee } = useMemo(() => resolveRoomSecrets(room, fromLink), [room, fromLink])

  // Put the recovered fragment back in the address bar. Not cosmetic: copy-link,
  // native share and the email invite all read `window.location.href`, so a tab
  // whose fragment was eaten by the auth redirect was handing out dead invite links
  // to everyone it shared with — one person signing in mid-call could break the
  // link for the whole room. Restoring it here fixes every one of those callers at
  // once.
  //
  // Never over an auth fragment: Supabase has to consume its own tokens from the
  // hash at startup, and replacing it first would trade one lost credential for
  // another (isAuthFragment).
  useEffect(() => {
    if (!secret && !e2ee) return
    if (fromLink.secret || fromLink.e2ee) return
    if (isAuthFragment(location.hash)) return
    navigate({ pathname: location.pathname, search: location.search, hash: roomHash({ secret, e2ee }) }, {
      replace: true,
      state: location.state,
    })
  }, [secret, e2ee, fromLink, location.hash, location.pathname, location.search, location.state, navigate])

  const [token, setToken] = useState<string | null>(null)
  // The end-of-call screen, for the call that just ended here. Keyed by room so a
  // move to another call (merge, answering a ring) never shows it: the route has
  // already changed when the old call disconnects.
  const [ended, setEnded] = useState<{ room: string; reason: EndReason } | null>(null)
  const roomNow = useRef(room)
  roomNow.current = room
  // Set once the call CONNECTS, not when a token arrives: a connect that fails
  // also reports a disconnect first, and must show its real error, not "You were
  // disconnected".
  const callRoom = useRef<string | null>(null)
  // Anonymous usage count (lib/usage): how long the call lasted, as a range. Counted
  // once — on leaving, or on the tab closing mid-call.
  const joinedAt = useRef(0)
  const countLeft = useCallback(() => {
    if (!joinedAt.current) return
    countUsage('left', durationRange(Date.now() - joinedAt.current), surface())
    joinedAt.current = 0
  }, [])
  useEffect(() => {
    window.addEventListener('pagehide', countLeft)
    return () => window.removeEventListener('pagehide', countLeft)
  }, [countLeft])

  // Mirror the join token into the store so in-room host controls can present it
  // as the Bearer credential to the orchestrator (admit / moderate / roomflags).
  useEffect(() => {
    setRoomToken(token)
    return () => setRoomToken(null)
  }, [token, setRoomToken])
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  // The room is marked encrypted and this link had no key (see NeedFullLink).
  const [needKey, setNeedKey] = useState(false)
  const [waitingId, setWaitingId] = useState<string | null>(null)
  // Goes with waitingId: the proof knock-status asks for (the id itself is public).
  const waitClaim = useRef('')
  // Set when the knock reports the same account is already in the call on another
  // device — we hold the (already-minted) token and let the user pick "join anyway"
  // (companion, muted) vs "transfer here" (drop the other device) before connecting.
  const [deviceChoice, setDeviceChoice] = useState<string | null>(null)

  const handleJoin = useCallback(async () => {
    setError(null)
    if (!LIVEKIT_URL) {
      console.warn('No media server configured: set VITE_LIVEKIT_URL in .env, then restart the dev server.')
      setError('Calls aren’t set up here yet.')
      return
    }
    setConnecting(true)
    // Download the in-call chunk in parallel with the knock round-trip. By the time
    // a token comes back it's usually cached, so the Suspense fallback below never
    // mounts a *second* JoiningScreen — the join→connect handoff stops flashing on
    // mobile (module cache dedups this with the lazy() import).
    void import('@/islands/CallRoom')

    // Auto-retry transient failures with a short backoff before surfacing the
    // manual Join card (E3). A definitive failure (denied / duplicate / bad room)
    // breaks out immediately — retrying it would only waste the user's time.
    for (let attempt = 1; attempt <= JOIN_MAX_ATTEMPTS; attempt++) {
      addBreadcrumb('join attempt', { room, attempt })
      try {
        // Send the Supabase session token (if signed in), NOT a client-asserted
        // userId — the server derives the trusted account id from it. Absent → guest.
        const accessToken = (await (await getSupabase())?.auth.getSession())?.data.session?.access_token
        const device = await roomDeviceId(deviceId, room)
        const seat = seatFor(room, `${displayName}#${device}`)
        const res = await knock({ room, name: displayName, deviceId: device, accessToken, secret, seat, hasKey: Boolean(e2ee) })
        rememberSeat(room, res.identity, res.seat)
        if (res.token) {
          // Same account already in the call on another device? Don't auto-connect —
          // let the user choose companion vs transfer first (the token is held).
          if (res.alsoOnDevice) {
            setDeviceChoice(res.token)
            setConnecting(false)
          } else {
            setToken(res.token)
          }
        } else if (res.pending && res.requestId) {
          // Waiting room is on — wait for the host to admit us.
          waitClaim.current = res.claim ?? ''
          setWaitingId(res.requestId)
          setConnecting(false)
        } else {
          setError('Couldn’t join this call. Try again.')
          setConnecting(false)
        }
        return
      } catch (e) {
        // A dead invite link is definitive — no retry, no generic error toast. Show
        // the dedicated "link expired" screen that tells the user what to do next.
        if (e instanceof ApiError && e.code === 'link_expired') {
          setExpired(true)
          setConnecting(false)
          return
        }
        if (e instanceof ApiError && e.code === 'need_key') {
          setNeedKey(true)
          setConnecting(false)
          return
        }
        // The join-secret gate turned us away. If we got here on a REMEMBERED secret
        // it is stale (the room was recreated, or the link epoch moved), and keeping
        // it would make every future attempt fail the same way with nothing the user
        // could do about it — so forget it and let the next real link win.
        if (e instanceof ApiError && e.code === 'need_link') {
          forgetRoomSecrets(room)
          setError(e.message)
          setConnecting(false)
          return
        }
        // Beta gate rejections are definitive — no retry. Show the server's message
        // (invite-only / room full) verbatim rather than the generic join error.
        if (
          e instanceof ApiError &&
          (e.code === 'not_in_beta' || e.code === 'room_full' || e.code === 'seat_taken' || e.code === 'removed')
        ) {
          if (e.code === 'seat_taken') countUsage('join_error', 'seat_taken', surface())
          setError(e.message)
          setConnecting(false)
          return
        }
        const raw = e instanceof Error ? e.message : String(e)
        if (isTransientJoinError(e, raw) && attempt < JOIN_MAX_ATTEMPTS) {
          // Stay on the JoiningScreen (connecting && !error) and tell the user we're
          // retrying rather than flashing an error card between attempts.
          toast('Connection dropped — trying again…', 'info')
          await delay(JOIN_BACKOFF_MS[attempt - 1])
          continue
        }
        reportError(e, { context: 'join', room, attempt })
        countUsage('join_error', joinErrorClass(e), surface())
        setError(friendlyJoinError(e, raw))
        setConnecting(false)
        return
      }
    }
  }, [room, displayName, deviceId, secret, e2ee])

  // "You're already in on another device" choices (see deviceChoice). Both connect with
  // the held token; companion joins muted, transfer drops the other device.
  const joinAsCompanion = useCallback(() => {
    setDeviceChoice((tok) => {
      if (tok) {
        setCompanion(true)
        setToken(tok)
      }
      return null
    })
  }, [setCompanion])
  const transferHere = useCallback(() => {
    setDeviceChoice((tok) => {
      if (tok) {
        setCompanion(false)
        setToken(tok)
        // Drop our OTHER device(s) in this room. Server-mediated, authorized on the
        // signed token's account id (can't be forged). Fire-and-forget — the other
        // session receives the disconnect and self-exits.
        void roomDeviceId(deviceId, room)
          .then((device) => handoff(room, tok, device))
          .catch(() => {})
      }
      return null
    })
  }, [room, deviceId, setCompanion])
  const cancelDeviceChoice = useCallback(() => {
    setDeviceChoice(null)
    setConnecting(false)
  }, [])

  // While queued in the waiting room, poll for the host's decision: every 2s at
  // first, when an answer is likeliest, then every 5s. A request can wait up to 5
  // minutes, and at 2s throughout that was 150 requests per waiting guest. One at
  // a time — a slow answer never overlaps the next ask.
  useEffect(() => {
    if (!waitingId) return
    let stop = false
    let id = 0
    const started = Date.now()
    const next = () => {
      if (!stop) id = window.setTimeout(ask, Date.now() - started < 30_000 ? 2000 : 5000)
    }
    const ask = async () => {
      const s = await knockStatus(room, waitingId, waitClaim.current).catch(() => null)
      if (stop) return
      if (!s) return next()
      if (s.status === 'approved' && s.token) {
        rememberSeat(room, s.identity, s.seat)
        // If they backgrounded the app while waiting, ping them to come back.
        if (document.hidden) notifyAdmitted(room)
        setToken(s.token)
        setWaitingId(null)
      } else if (s.status === 'denied') {
        setError('The host declined your request to join.')
        setWaitingId(null)
      } else if (s.status === 'expired') {
        setWaitingId(null)
        setError(null)
        toast('Your request to join timed out — try again', 'warning')
      } else {
        next()
      }
    }
    next()
    return () => {
      stop = true
      window.clearTimeout(id)
    }
  }, [waitingId, room])

  // On a merge, navigation lands here with { autojoin } and a new room param.
  // Reset the old connection and auto-join the target without a second prejoin.
  const autojoin = Boolean((location.state as { autojoin?: boolean } | null)?.autojoin)
  const joinedFor = useRef<string | null>(null)
  const prevRoom = useRef(room)
  useEffect(() => {
    // Only tear down the connection when the ROOM actually changes (e.g. a merge).
    // Previously this ran on every displayName keystroke / handleJoin identity
    // change and nulled the live token — churn that could flicker or drop a call.
    if (prevRoom.current !== room) {
      prevRoom.current = room
      setToken(null)
      setConnecting(false)
      setWaitingId(null)
      setError(null)
      setExpired(false)
      setNeedKey(false)
      setDeviceChoice(null)
      setCompanion(false)
    }
    if (autojoin && displayName && joinedFor.current !== room) {
      joinedFor.current = room
      void handleJoin()
    }
  }, [room, autojoin, displayName, handleJoin])

  function leave(reason?: EndReason) {
    countLeft()
    const why = takeEnd(reason ?? 'left')
    const was = callRoom.current
    callRoom.current = null
    setToken(null)
    setConnecting(false)
    setWaitingId(null)
    setDeviceChoice(null)
    setCompanion(false)
    // Called twice per ending (LiveKit's disconnect, then the app's own onLeave);
    // the first one decides.
    if (was && was === roomNow.current) setEnded({ room: was, reason: why })
  }

  // Proven flow: once we hold a token, LiveKitRoom mounts and RoomView shows its
  // own "Joining" cover until connected. (An earlier single-overlay refactor could
  // leave a full-screen cover up if the connected signal missed — taking the whole
  // call hostage. Reverted: correctness over the small remount glitch.)
  if (token && LIVEKIT_URL) {
    return (
      <Suspense fallback={<JoiningScreen room={room} />}>
        <CallRoom
          serverUrl={LIVEKIT_URL}
          token={token}
          // Companion (same account on another device): join with mic + camera off to
          // avoid echo / a duplicate self-view. Speaker mute + the companion banner are
          // applied in-call by RoomView.
          micEnabled={companion ? false : prejoin.micEnabled}
          cameraEnabled={companion ? false : prejoin.cameraEnabled}
          lowBandwidth={prejoin.lowBandwidth}
          e2ee={e2ee}
          onLeave={leave}
          onConnected={() => {
            callRoom.current = roomNow.current
            if (!joinedAt.current) {
              joinedAt.current = Date.now()
              countUsage(
                'joined',
                !companion && prejoin.cameraEnabled && !prejoin.lowBandwidth ? 'cam_on' : 'cam_off',
                prejoin.lowBandwidth ? 'low_on' : 'low_off',
              )
            }
          }}
          onError={(e) => {
            countLeft()
            if (!callRoom.current) countUsage('join_error', joinErrorClass(e), surface())
            callRoom.current = null
            reportError(e, { context: 'livekit-room', room })
            setError(friendlyJoinError(e, e.message))
            setToken(null)
            setConnecting(false)
          }}
        />
      </Suspense>
    )
  }

  if (ended && ended.room === room) {
    return (
      <CallEnded
        room={room}
        reason={ended.reason}
        onRejoin={() => {
          setEnded(null)
          void handleJoin()
        }}
        onHome={() => navigate('/')}
      />
    )
  }

  if (expired) {
    // "Start a new call" means that: the home page mints one on arrival.
    return <ExpiredLink room={room} onHome={() => navigate('/', { state: { newCall: true } })} />
  }

  // Opening the full link afterwards brings the key, and this screen steps aside.
  if (needKey && !e2ee) {
    return <NeedFullLink room={room} onHome={() => navigate('/')} />
  }

  if (waitingId) {
    return (
      <WaitingRoom
        room={room}
        onCancel={() => {
          leave()
          navigate('/')
        }}
      />
    )
  }

  if (connecting && !error) {
    return <JoiningScreen room={room} />
  }

  return (
    <div className="relative">
      <PreJoin room={room} onJoin={handleJoin} encrypted={Boolean(e2ee)} />
      {deviceChoice && (
        <AlreadyOnDevicePrompt
          onJoinAnyway={joinAsCompanion}
          onTransfer={transferHere}
          onCancel={cancelDeviceChoice}
        />
      )}
      {error && (
        <div className="fixed inset-x-0 top-4 z-30 flex justify-center px-4">
          <Island elevation="raised" className="max-w-md">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger-text">{error}</p>
              <Button size="sm" variant="neutral" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </div>
          </Island>
        </div>
      )}
    </div>
  )
}

/**
 * Dead-end screen for an expired invite link. A link with no activity for 30 days
 * is retired server-side (see core.mjs LINK_TTL_MS), so rather than silently spawn a
 * fresh room under the same slug we land here and tell the user plainly what
 * happened and what to do: start a new meeting (the old slug stays retired) and ask
 * whoever shared it for a current link.
 */
const ENDED_COPY: Record<EndReason, { title: string; body: string; rejoin: boolean }> = {
  left: { title: 'You left the call', body: 'Rejoin if that was a mistake.', rejoin: true },
  ended: { title: 'The host ended the call', body: 'It’s over for everyone.', rejoin: false },
  endedByYou: { title: 'You ended the call for everyone', body: 'Everyone was disconnected.', rejoin: false },
  removed: { title: 'The host removed you from this call', body: 'You can’t rejoin it from this browser.', rejoin: false },
  moved: { title: 'You moved this call to another device', body: 'It’s still going there.', rejoin: false },
  alone: {
    title: 'The call ended',
    body: 'No one else was here for five minutes, so it ended to save your data and battery.',
    rejoin: true,
  },
  dropped: { title: 'You were disconnected', body: 'Check your connection, then rejoin.', rejoin: true },
}

/**
 * The end of a call: what happened, in words, and the one or two things you can do
 * next (Meet and Teams do the same). It used to drop you on the home page with
 * no explanation, or at best an 8-second Rejoin toast.
 */
function CallEnded({
  room,
  reason,
  onRejoin,
  onHome,
}: {
  room: string
  reason: EndReason
  onRejoin: () => void
  onHome: () => void
}) {
  const copy = ENDED_COPY[reason]
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Island pad="lg" className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-medium text-ink">{prettyRoom(room)}</span> · {copy.body}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {copy.rejoin && (
            <Button variant="accent" block onClick={onRejoin}>
              Rejoin
            </Button>
          )}
          <Button variant={copy.rejoin ? 'neutral' : 'accent'} block onClick={onHome}>
            Go home
          </Button>
        </div>
      </Island>
    </main>
  )
}

function ExpiredLink({ room, onHome }: { room: string; onHome: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Island pad="lg" className="w-full max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-muted [&_svg]:size-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
        <h1 className="mt-4 text-lg font-semibold">This link has expired</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The invite for <span className="font-medium text-ink">{prettyRoom(room)}</span> hasn’t been
          used in a while, so it’s no longer active. Start a new call and share its link — or
          ask whoever invited you for a current one.
        </p>
        <Button variant="accent" className="mt-5" onClick={onHome}>
          Start a new call
        </Button>
      </Island>
    </main>
  )
}

/**
 * The call is end-to-end encrypted and the link that brought you here has no key.
 * Emailed invites leave it out on purpose (so the key never passes through a mail
 * provider), and joining without it would put you in a call you can't see or hear
 * while your own camera went out unencrypted. So the server turns the knock away
 * (need_key) and this says what to do instead.
 */
function NeedFullLink({ room, onHome }: { room: string; onHome: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Island pad="lg" className="w-full max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-muted [&_svg]:size-6">
          <LockIcon />
        </span>
        <h1 className="mt-4 text-lg font-semibold">This call is encrypted</h1>
        <p className="mt-1 text-sm text-ink-muted">
          To join <span className="font-medium text-ink">{prettyRoom(room)}</span> you need its full
          invite link. Email invites leave out the encryption key, so it never passes through a mail
          server. Ask whoever invited you for the full link.
        </p>
        <Button variant="accent" className="mt-5" onClick={onHome}>
          Go home
        </Button>
      </Island>
    </main>
  )
}

/**
 * Prejoin prompt shown when the SAME account is already in the call on another device
 * (Meet/Teams model). Two paths: "Join anyway" adds this device as a muted companion
 * (mic + camera + speaker off, so two co-located devices don't echo — the user can turn
 * any back on in-call); "Transfer to this device" moves the call here and drops the
 * other session. Cancel returns to prejoin.
 */
function AlreadyOnDevicePrompt({
  onJoinAnyway,
  onTransfer,
  onCancel,
}: {
  onJoinAnyway: () => void
  onTransfer: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <Island pad="lg" className="w-full max-w-sm">
        <h2 className="text-lg font-semibold">You’re already in this call</h2>
        <p className="mt-1 text-sm text-ink-muted">
          You’re in this call on another device. Join here too (muted, to avoid echo), or move the
          call to this device.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="accent" onClick={onJoinAnyway}>
            Join anyway
          </Button>
          <Button variant="neutral" onClick={onTransfer}>
            Transfer to this device
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Island>
    </div>
  )
}

/**
 * The "waiting to be let in" lobby. On a phone the guest is likely to switch apps
 * while waiting, so offer a one-tap opt-in for an OS notification when admitted
 * (the actual notification fires from the poll above when the tab is hidden). The
 * permission request is gesture-driven (this button), which browsers honour.
 */
function WaitingRoom({ room, onCancel }: { room: string; onCancel: () => void }) {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission>(() =>
    supported ? Notification.permission : 'denied',
  )
  // Elapsed wait, so a long wait reads as time passing instead of a silently
  // stalled page (the 2s poll is invisible by design).
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setWaited((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  async function arm() {
    try {
      setPerm(await Notification.requestPermission())
    } catch {
      setPerm('denied')
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Island pad="lg" className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">Waiting to be let in</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The host has been notified. You’ll join {prettyRoom(room)} as soon as they admit you.
        </p>
        <p className="mt-1 text-xs text-ink-subtle tabular-nums">
          Waiting {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}
        </p>
        {supported && perm === 'default' && (
          <Button variant="neutral" className="mt-4" onClick={() => void arm()}>
            Notify me when I’m let in
          </Button>
        )}
        {supported && perm === 'granted' && (
          <p className="mt-4 text-xs text-ink-subtle">
            We’ll notify you the moment you’re admitted — you can switch to another app.
          </p>
        )}
        <div className="mt-4">
          <Button variant="neutral" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Island>
    </main>
  )
}
