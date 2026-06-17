import { useMemo } from 'react'
import { LiveKitRoom } from '@livekit/components-react'
import { RoomView } from '@/islands/RoomView'
import { roomOptions } from '@/lib/livekit'

/**
 * The whole in-call subtree (LiveKitRoom provider + RoomView). Split into its own
 * lazy chunk so the prejoin screen doesn't download livekit-client / the effects
 * stack (~200KB) before the user has actually joined — they load on join. Keep
 * everything that pulls `livekit-client` (RoomView, roomOptions) behind this
 * boundary; importing any of it eagerly in RoomRoute would defeat the split.
 */
export interface CallRoomProps {
  serverUrl: string
  token: string
  micEnabled: boolean
  cameraEnabled: boolean
  lowBandwidth: boolean
  e2ee?: string
  onLeave: () => void
  onError: (error: Error) => void
}

export default function CallRoom({
  serverUrl,
  token,
  micEnabled,
  cameraEnabled,
  lowBandwidth,
  e2ee,
  onLeave,
  onError,
}: CallRoomProps) {
  // Build once per (bandwidth, passphrase) so the E2EE worker isn't recreated.
  const options = useMemo(() => roomOptions(lowBandwidth, e2ee), [lowBandwidth, e2ee])
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio={micEnabled}
      video={cameraEnabled && !lowBandwidth}
      options={options}
      onDisconnected={onLeave}
      onError={onError}
      className="relative flex min-h-dvh flex-col"
    >
      <RoomView onLeave={onLeave} />
    </LiveKitRoom>
  )
}
