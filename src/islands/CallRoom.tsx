import { useCallback, useMemo, useRef } from 'react'
import { LiveKitRoom } from '@livekit/components-react'
import { RoomView } from '@/islands/RoomView'
import { AnnouncerProvider } from '@/features/a11y/AnnouncerContext'
import { roomOptions } from '@/lib/livekit'
import { mediaErrorMessage } from '@/lib/mediaErrors'

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
  // LiveKitRoom reports a failed initial mic/camera publish through onError, the
  // same callback as a failed connect (lib/mediaErrors). Only the latter ends the
  // join; a device that won't start leaves you in the call without it. Saying why
  // is useMediaDeviceWatch's job: LiveKit raises MediaDevicesError for the same
  // failure first, so a toast here too would double it.
  // Held in a ref so the handler is stable — LiveKitRoom re-binds its room
  // listeners whenever this prop's identity changes.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const handleError = useCallback((e: Error) => {
    if (!mediaErrorMessage(e)) onErrorRef.current(e)
  }, [])
  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio={micEnabled}
      video={cameraEnabled && !lowBandwidth}
      options={options}
      onDisconnected={onLeave}
      onError={handleError}
      className="relative flex h-dvh flex-col overflow-hidden"
    >
      {/* Shared announcer for the call subtree — RoomView + its hooks (device-loss
          watch) voice through one set of live regions. */}
      <AnnouncerProvider>
        <RoomView onLeave={onLeave} />
      </AnnouncerProvider>
    </LiveKitRoom>
  )
}
