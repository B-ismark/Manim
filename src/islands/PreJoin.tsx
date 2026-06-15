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
  // 'prompt' → we can prime; 'denied' → guide to OS settings; 'granted'/unknown → nothing.
  const [permission, setPermission] = useState<'unknown' | 'prompt' | 'granted' | 'denied'>(
    'unknown',
  )
  const [priming, setPriming] = useState(false)

  const cameraOn = prejoin.cameraEnabled && !prejoin.lowBandwidth

  // Best-effort read of the current camera/mic grant so we can show a rationale
  // *before* the OS prompt (priming) instead of a bare browser dialog. The
  // Permissions API is absent on some browsers (notably older Safari) — there we
  // stay 'unknown' and simply don't nag.
  useEffect(() => {
    let cancelled = false
    async function probe() {
      const perms = navigator.permissions as
        | (Permissions & { query: Permissions['query'] })
        | undefined
      if (!perms?.query) return
      try {
        const [cam, mic] = await Promise.all([
          perms.query({ name: 'camera' as PermissionName }),
          perms.query({ name: 'microphone' as PermissionName }),
        ])
        if (cancelled) return
        const states = [cam.state, mic.state]
        setPermission(
          states.includes('denied')
            ? 'denied'
            : states.includes('prompt')
              ? 'prompt'
              : 'granted',
        )
      } catch {
        /* unsupported permission name — leave unknown */
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [])

  // Pre-warm both camera and mic so the in-call connect doesn't re-prompt
  // mid-join. We immediately stop the tracks — the preview effect re-acquires
  // video on its own; this only moves the OS prompt to an intentional tap.
  async function requestAccess() {
    setPriming(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setPermission('granted')
      setError(null)
    } catch {
      setPermission('denied')
      setError('Camera and microphone access was blocked. Enable it in your browser settings.')
    } finally {
      setPriming(false)
    }
  }

  const showPriming = permission === 'prompt'

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

        {/* Portrait on touch (matches the in-call tiles), landscape on desktop. */}
        <div className="mx-auto mt-4 aspect-[3/4] w-full max-w-[20rem] overflow-hidden rounded-tile bg-sunken pointer-fine:aspect-video pointer-fine:max-w-none">
          {cameraOn ? (
            <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover [transform:scaleX(-1)]" />
          ) : (
            <div className="grid size-full place-items-center text-sm text-ink-subtle">
              {prejoin.lowBandwidth ? 'Audio-only / low bandwidth' : 'Camera off'}
            </div>
          )}
        </div>

        {/* Device toggles sit below the preview (not floating over it) so the
            keyboard never covers them once the name field is focused. */}
        <div className="mt-3 flex justify-center gap-3">
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

        {showPriming && (
          <div className="mt-3 rounded-field bg-sunken p-3 text-center">
            <p className="text-sm text-ink">
              We'll ask for camera and microphone access so others can see and hear you.
            </p>
            <Button variant="accent" className="mt-2" disabled={priming} onClick={requestAccess}>
              {priming ? 'Requesting…' : 'Allow camera & microphone'}
            </Button>
          </div>
        )}

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

          <details className="rounded-field bg-sunken px-3 py-2">
            <summary className="cursor-pointer select-none text-sm text-ink-muted">
              End-to-end encryption
            </summary>
            <input
              type="password"
              value={prejoin.e2ee ?? ''}
              onChange={(e) => setPrejoin({ e2ee: e.target.value })}
              placeholder="Shared passphrase (optional)"
              aria-label="End-to-end encryption passphrase"
              autoComplete="off"
              className="mt-2 h-10 w-full rounded-field bg-surface px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="mt-1.5 text-xs text-ink-subtle">Everyone needs the same passphrase.</p>
          </details>

          <Button variant="accent" size="lg" block disabled={!canJoin} onClick={onJoin}>
            Join now
          </Button>
        </div>
      </Island>
    </main>
  )
}
