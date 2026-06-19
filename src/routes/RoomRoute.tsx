import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Island, Button } from '@/components/primitives'
import { PreJoin } from '@/islands/PreJoin'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { useAppStore } from '@/store/useAppStore'
import { knock, knockStatus, LIVEKIT_URL, ApiError } from '@/lib/orchestrator'
import { supabase } from '@/lib/supabase'
import { parseRoomHash } from '@/lib/roomLink'
import { toast } from '@/store/useToastStore'
import { prettyRoom } from '@/lib/roomName'
import { addBreadcrumb, reportError } from '@/lib/report'

/**
 * Fire a local OS notification when the host admits a *backgrounded* guest. The
 * waiting-room tab is still alive (just hidden), so a foreground Notification +
 * a vibrate is enough — no Web Push / service worker needed. No-op unless the
 * user opted in from the waiting screen (permission granted).
 */
function notifyAdmitted(room: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification("You're in — tap to join", {
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
 * Turn a raw LiveKit connection-error / disconnect string into something a user
 * can act on. The headline offender was "Client initiated disconnect" surfacing
 * verbatim when a mobile join was torn down (e.g. a duplicate session or the tab
 * backgrounding mid-connect) — meaningless to the user. Map the known ones; pass
 * anything genuinely unexpected through unchanged.
 */
function friendlyJoinError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('client initiated') || m.includes('duplicate identity')) {
    return 'Connection closed — tap Join to reconnect.'
  }
  if (m.includes('timeout') || m.includes('could not establish') || m.includes('failed to connect')) {
    return 'Couldn’t reach the call. Check your connection and tap Join to retry.'
  }
  if (m.includes('permission') || m.includes('notallowed') || m.includes('denied')) {
    return 'Allow camera and microphone access, then tap Join.'
  }
  return raw
}

/**
 * A *transient* join failure — a flaky network, a timed-out knock, a dropped
 * fetch — as opposed to a definitive one (denied, duplicate identity, bad room).
 * The in-call path auto-reconnects; only the INITIAL join had no retry (E3), so a
 * mobile user on a spotty connection had to manually re-tap Join. We auto-retry
 * just these classes with a short backoff before falling back to the manual card.
 */
function isTransientJoinError(raw: string): boolean {
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

  const displayName = useAppStore((s) => s.displayName)
  const deviceId = useAppStore((s) => s.deviceId)
  const prejoin = useAppStore((s) => s.prejoin)
  const setRoomToken = useAppStore((s) => s.setRoomToken)

  // Security material rides in the URL #fragment (see lib/roomLink): the join
  // secret gates server-side entry, the E2EE key keys the media. Both live only in
  // the link, never the path/store.
  const { secret, e2ee } = useMemo(() => parseRoomHash(location.hash), [location.hash])

  const [token, setToken] = useState<string | null>(null)

  // Mirror the join token into the store so in-room host controls can present it
  // as the Bearer credential to the orchestrator (admit / moderate / roomflags).
  useEffect(() => {
    setRoomToken(token)
    return () => setRoomToken(null)
  }, [token, setRoomToken])
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [waitingId, setWaitingId] = useState<string | null>(null)

  const handleJoin = useCallback(async () => {
    setError(null)
    if (!LIVEKIT_URL) {
      setError('No media server configured. Set VITE_LIVEKIT_URL in .env (LiveKit Cloud ws URL), then restart the dev server.')
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
        const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token
        const res = await knock({ room, name: displayName, deviceId, accessToken, secret })
        if (res.token) {
          setToken(res.token)
        } else if (res.pending && res.requestId) {
          // Waiting room is on — wait for the host to admit us.
          setWaitingId(res.requestId)
          setConnecting(false)
        } else {
          setError('Could not join this room.')
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
        const raw = e instanceof Error ? e.message : 'Failed to join'
        if (isTransientJoinError(raw) && attempt < JOIN_MAX_ATTEMPTS) {
          // Stay on the JoiningScreen (connecting && !error) and tell the user we're
          // retrying rather than flashing an error card between attempts.
          toast('Connection hiccup — reconnecting…', 'info')
          await delay(JOIN_BACKOFF_MS[attempt - 1])
          continue
        }
        reportError(e, { context: 'join', room, attempt })
        setError(friendlyJoinError(raw))
        setConnecting(false)
        return
      }
    }
  }, [room, displayName, deviceId, secret])

  // While queued in the waiting room, poll for the host's decision.
  useEffect(() => {
    if (!waitingId) return
    let stop = false
    const id = window.setInterval(async () => {
      const s = await knockStatus(room, waitingId)
      if (stop) return
      if (s.status === 'approved' && s.token) {
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
      }
    }, 2000)
    return () => {
      stop = true
      window.clearInterval(id)
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
    }
    if (autojoin && displayName && joinedFor.current !== room) {
      joinedFor.current = room
      void handleJoin()
    }
  }, [room, autojoin, displayName, handleJoin])

  function leave() {
    setToken(null)
    setConnecting(false)
    setWaitingId(null)
    navigate('/')
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
          micEnabled={prejoin.micEnabled}
          cameraEnabled={prejoin.cameraEnabled}
          lowBandwidth={prejoin.lowBandwidth}
          e2ee={e2ee}
          onLeave={leave}
          onError={(e) => {
            reportError(e, { context: 'livekit-room', room })
            setError(friendlyJoinError(e.message))
            setToken(null)
            setConnecting(false)
          }}
        />
      </Suspense>
    )
  }

  if (expired) {
    return <ExpiredLink room={room} onHome={() => navigate('/')} />
  }

  if (waitingId) {
    return <WaitingRoom room={room} onCancel={leave} />
  }

  if (connecting && !error) {
    return <JoiningScreen room={room} />
  }

  return (
    <div className="relative">
      <PreJoin room={room} onJoin={handleJoin} encrypted={Boolean(e2ee)} />
      {error && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
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
          The invite for <span className="font-medium text-ink">{prettyRoom(room)}</span> hasn't been
          used in a while, so it's no longer active. Start a new meeting and share its fresh link — or
          ask whoever invited you for a current one.
        </p>
        <Button variant="accent" className="mt-5" onClick={onHome}>
          Start a new meeting
        </Button>
      </Island>
    </main>
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
          The host has been notified. You'll join {prettyRoom(room)} as soon as they admit you.
        </p>
        {supported && perm === 'default' && (
          <Button variant="neutral" className="mt-4" onClick={() => void arm()}>
            Notify me when I'm let in
          </Button>
        )}
        {supported && perm === 'granted' && (
          <p className="mt-4 text-xs text-ink-subtle">
            We'll notify you the moment you're admitted — you can switch to another app.
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
