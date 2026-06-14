import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LiveKitRoom } from '@livekit/components-react'
import { Island, Button } from '@/components/primitives'
import { PreJoin } from '@/islands/PreJoin'
import { RoomView } from '@/islands/RoomView'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { knock, knockStatus, LIVEKIT_URL } from '@/lib/orchestrator'
import { roomOptions } from '@/lib/livekit'

export function RoomRoute() {
  const { room = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const displayName = useAppStore((s) => s.displayName)
  const deviceId = useAppStore((s) => s.deviceId)
  const prejoin = useAppStore((s) => s.prejoin)
  const userId = useAuthStore((s) => s.userId)

  const [token, setToken] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waitingId, setWaitingId] = useState<string | null>(null)

  // Build once per (bandwidth, passphrase) so the E2EE worker isn't recreated.
  const options = useMemo(
    () => roomOptions(prejoin.lowBandwidth, prejoin.e2ee),
    [prejoin.lowBandwidth, prejoin.e2ee],
  )

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
  useEffect(() => {
    setToken(null)
    setConnecting(false)
    setWaitingId(null)
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

  if (token && LIVEKIT_URL) {
    return (
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={token}
        connect
        audio={prejoin.micEnabled}
        video={prejoin.cameraEnabled && !prejoin.lowBandwidth}
        options={options}
        onDisconnected={leave}
        onError={(e) => {
          setError(e.message)
          setToken(null)
          setConnecting(false)
        }}
        className="relative flex min-h-dvh flex-col"
      >
        <RoomView onLeave={leave} />
      </LiveKitRoom>
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

  // Connecting (knock in flight) with no error yet → full joining experience.
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
