import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, IconButton, Island, Toggle } from '@/components/primitives'
import { CameraIcon, CameraOffIcon, ChevronLeftIcon, MicIcon, MicOffIcon } from '@/components/icons'
import { useAppStore } from '@/store/useAppStore'
import { prettyRoom } from '@/lib/roomName'

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
        // A successful preview means access is already granted — never show the
        // priming card (esp. on browsers without the Permissions API).
        setPermission('granted')
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
    // items-start + scroll so a tall card on a short phone stays reachable
    // (items-center would strand the top off-screen with no way to scroll).
    <main className="min-h-dvh flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <Island pad="none" className="my-auto w-full max-w-lg p-4 sm:p-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-field py-1 pr-2 text-sm text-ink-muted hover:text-ink [&_svg]:size-4"
        >
          <ChevronLeftIcon />
          Back
        </button>
        <p className="text-xs font-medium text-ink-subtle">Joining</p>
        <h1 className="text-xl font-semibold">{prettyRoom(room)}</h1>

        {/* Portrait on touch (matches the in-call tiles), landscape on desktop.
            Height is capped (max-h) so the preview never pushes the name field and
            Join button off a short viewport — the real cause of pre-join scrolling. */}
        <div className="mx-auto mt-3 aspect-[3/4] max-h-[32dvh] w-full max-w-[20rem] overflow-hidden rounded-tile bg-sunken pointer-fine:mt-4 pointer-fine:aspect-video pointer-fine:max-h-none pointer-fine:max-w-none">
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

        {permission !== 'prompt' && permission !== 'denied' && (
          <MicSpeakerTest micEnabled={prejoin.micEnabled} />
        )}

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

        <div className="mt-3 flex flex-col gap-2.5 sm:mt-4 sm:gap-3">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              // Enter = the primary action (Join), the expected keyboard flow.
              if (e.key === 'Enter' && canJoin) {
                e.preventDefault()
                onJoin()
              }
            }}
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

/** A live mic level bar + a speaker test tone, so users can verify audio before
 *  joining (the camera already previews). Uses Web Audio; cleans up fully. */
function MicSpeakerTest({ micEnabled }: { micEnabled: boolean }) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!micEnabled) {
      setLevel(0)
      return
    }
    let raf = 0
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        ctx = new Ctx()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        ctx.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(Math.min(1, peak / 64))
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => {})
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => {})
    }
  }, [micEnabled])

  function testSpeaker() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.35)
      osc.onended = () => void ctx.close().catch(() => {})
    } catch {
      /* Web Audio unavailable */
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex flex-1 items-center gap-2">
        {micEnabled ? <MicIcon className="size-4 text-ink-muted" /> : <MicOffIcon className="size-4 text-ink-subtle" />}
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-success transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>
      <Button type="button" variant="neutral" size="sm" onClick={testSpeaker}>
        Test speaker
      </Button>
    </div>
  )
}
