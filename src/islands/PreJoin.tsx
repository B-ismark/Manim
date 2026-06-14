import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, IconButton, Island, Toggle } from '@/components/primitives'
import { CameraIcon, CameraOffIcon, ChevronLeftIcon, MicIcon, MicOffIcon } from '@/components/icons'
import { useAppStore } from '@/store/useAppStore'

export interface PreJoinProps {
  room: string
  onJoin: () => void
}

/**
 * Device check + name entry before entering. Sets expectations and lets the
 * user pick mic/cam/quality before consuming any media bandwidth.
 */
export function PreJoin({ room, onJoin }: PreJoinProps) {
  const navigate = useNavigate()
  const displayName = useAppStore((s) => s.displayName)
  const setDisplayName = useAppStore((s) => s.setDisplayName)
  const prejoin = useAppStore((s) => s.prejoin)
  const setPrejoin = useAppStore((s) => s.setPrejoin)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cameraOn = prejoin.cameraEnabled && !prejoin.lowBandwidth

  // Preview only needs video — the mic isn't monitored here, so toggling it is a
  // pure intent flag (applied at connect) and must not restart the stream, which
  // would flicker the video. Re-acquire only when the camera intent changes.
  useEffect(() => {
    let cancelled = false

    async function start() {
      stop()
      if (!cameraOn) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setError(null)
      } catch {
        setError('Camera permission denied or unavailable.')
      }
    }

    function stop() {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    start()
    return () => {
      cancelled = true
      stop()
    }
  }, [cameraOn])

  const canJoin = displayName.trim().length > 0

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <Island pad="lg" className="w-full max-w-lg">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-field py-1 pr-2 text-sm text-ink-muted hover:text-ink [&_svg]:size-4"
        >
          <ChevronLeftIcon />
          Back
        </button>
        <p className="text-xs font-medium text-ink-subtle">Joining</p>
        <h1 className="text-xl font-semibold">{room}</h1>

        <div className="relative mt-4 aspect-video w-full overflow-hidden rounded-tile bg-sunken">
          {cameraOn ? (
            <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover [transform:scaleX(-1)]" />
          ) : (
            <div className="grid size-full place-items-center text-sm text-ink-subtle">
              {prejoin.lowBandwidth ? 'Audio-only / low bandwidth' : 'Camera off'}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-3">
            <IconButton
              label={prejoin.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              icon={prejoin.micEnabled ? <MicIcon /> : <MicOffIcon />}
              tone={prejoin.micEnabled ? 'neutral' : 'danger'}
              active={!prejoin.micEnabled}
              onClick={() => setPrejoin({ micEnabled: !prejoin.micEnabled })}
            />
            <IconButton
              label={prejoin.cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              icon={prejoin.cameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
              tone={prejoin.cameraEnabled ? 'neutral' : 'danger'}
              active={!prejoin.cameraEnabled}
              disabled={prejoin.lowBandwidth}
              onClick={() => setPrejoin({ cameraEnabled: !prejoin.cameraEnabled })}
            />
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex flex-col gap-3">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="name"
            className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />

          <Toggle
            checked={prejoin.lowBandwidth}
            onCheckedChange={(v) => setPrejoin({ lowBandwidth: v, cameraEnabled: v ? false : prejoin.cameraEnabled })}
            label="Low-bandwidth mode (audio-first)"
          />

          <Button variant="accent" size="lg" block disabled={!canJoin} onClick={onJoin}>
            Join now
          </Button>
        </div>
      </Island>
    </main>
  )
}
