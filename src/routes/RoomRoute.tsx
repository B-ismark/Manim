import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LiveKitRoom } from '@livekit/components-react'
import { Island, Button } from '@/components/primitives'
import { PreJoin } from '@/islands/PreJoin'
import { RoomView } from '@/islands/RoomView'
import { useAppStore } from '@/store/useAppStore'
import { fetchToken, LIVEKIT_URL } from '@/lib/orchestrator'
import { roomOptions } from '@/lib/livekit'

export function RoomRoute() {
  const { room = '' } = useParams()
  const navigate = useNavigate()

  const displayName = useAppStore((s) => s.displayName)
  const deviceId = useAppStore((s) => s.deviceId)
  const prejoin = useAppStore((s) => s.prejoin)

  const [token, setToken] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin() {
    setError(null)
    if (!LIVEKIT_URL) {
      setError('No media server configured. Set VITE_LIVEKIT_URL in .env (LiveKit Cloud ws URL), then restart the dev server.')
      return
    }
    setConnecting(true)
    try {
      const { token } = await fetchToken({ room, name: displayName, deviceId })
      setToken(token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join')
      setConnecting(false)
    }
  }

  function leave() {
    setToken(null)
    setConnecting(false)
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
        options={roomOptions(prejoin.lowBandwidth)}
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

  return (
    <div className="relative">
      <PreJoin room={room} onJoin={handleJoin} />
      {(error || connecting) && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Island elevation="raised" className="max-w-md">
            {connecting && !error ? (
              <p className="text-sm text-ink-muted">Connecting…</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-danger">{error}</p>
                <Button size="sm" variant="neutral" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </div>
            )}
          </Island>
        </div>
      )}
    </div>
  )
}
