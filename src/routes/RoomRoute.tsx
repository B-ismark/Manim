import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Island, Button } from '@/components/primitives'
import { PreJoin } from '@/islands/PreJoin'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { knock, knockStatus, LIVEKIT_URL } from '@/lib/orchestrator'
import { toast } from '@/store/useToastStore'

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

export function RoomRoute() {
  const { room = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const displayName = useAppStore((s) => s.displayName)
  const deviceId = useAppStore((s) => s.deviceId)
  const prejoin = useAppStore((s) => s.prejoin)
  const setRoomToken = useAppStore((s) => s.setRoomToken)
  const userId = useAuthStore((s) => s.userId)

  const [token, setToken] = useState<string | null>(null)

  // Mirror the join token into the store so in-room host controls can present it
  // as the Bearer credential to the orchestrator (admit / moderate / roomflags).
  useEffect(() => {
    setRoomToken(token)
    return () => setRoomToken(null)
  }, [token, setRoomToken])
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waitingId, setWaitingId] = useState<string | null>(null)

  const handleJoin = useCallback(async () => {
    setError(null)
    if (!LIVEKIT_URL) {
      setError('No media server configured. Set VITE_LIVEKIT_URL in .env (LiveKit Cloud ws URL), then restart the dev server.')
      return
    }
    setConnecting(true)
    try {
      const res = await knock({ room, name: displayName, deviceId, userId })
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join')
      setConnecting(false)
    }
  }, [room, displayName, deviceId, userId])

  // While queued in the waiting room, poll for the host's decision.
  useEffect(() => {
    if (!waitingId) return
    let stop = false
    const id = window.setInterval(async () => {
      const s = await knockStatus(room, waitingId)
      if (stop) return
      if (s.status === 'approved' && s.token) {
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
          e2ee={prejoin.e2ee}
          onLeave={leave}
          onError={(e) => {
            setError(friendlyJoinError(e.message))
            setToken(null)
            setConnecting(false)
          }}
        />
      </Suspense>
    )
  }

  if (waitingId) {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <Island pad="lg" className="w-full max-w-sm text-center">
          <h1 className="text-lg font-semibold">Waiting to be let in</h1>
          <p className="mt-1 text-sm text-ink-muted">
            The host has been notified. You'll join {room} as soon as they admit you.
          </p>
          <Button variant="neutral" className="mt-4" onClick={leave}>
            Cancel
          </Button>
        </Island>
      </main>
    )
  }

  if (connecting && !error) {
    return <JoiningScreen room={room} />
  }

  return (
    <div className="relative">
      <PreJoin room={room} onJoin={handleJoin} />
      {error && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Island elevation="raised" className="max-w-md">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-danger">{error}</p>
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
