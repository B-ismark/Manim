import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, IconButton, Island, Toggle } from '@/components/primitives'
import { CameraIcon, CameraOffIcon, CheckIcon, ChevronLeftIcon, LockIcon, MicIcon, MicOffIcon, ShareIcon } from '@/components/icons'
import { useAppStore } from '@/store/useAppStore'
import { prettyRoom } from '@/lib/roomName'
import { useShareLink } from '@/lib/useShareLink'
import { APP_NAME } from '@/lib/legal'

/** Bounds on the preview box's shape. Real cameras live inside 9:16 (portrait phone)
 *  … 16:9 (laptop); anything outside is a bogus or freak mode, and letting it through
 *  would hand the card an unusable sliver. Clamped ratios letterbox (object-contain)
 *  rather than crop, so even then nothing is hidden from the user. */
const MIN_PREVIEW_ASPECT = 9 / 16
const MAX_PREVIEW_ASPECT = 16 / 9
const clampAspect = (r: number) =>
  Number.isFinite(r) && r > 0 ? Math.min(MAX_PREVIEW_ASPECT, Math.max(MIN_PREVIEW_ASPECT, r)) : 4 / 3

export interface PreJoinProps {
  room: string
  onJoin: () => void
  /** True when the invite link carries an E2EE key (#e) — the call is encrypted. */
  encrypted?: boolean
}

/**
 * Device check + name entry before entering. Sets expectations and lets the
 * user pick mic/cam/quality before consuming any media bandwidth.
 */
export function PreJoin({ room, onJoin, encrypted = false }: PreJoinProps) {
  const navigate = useNavigate()
  const { copied, share } = useShareLink()
  const displayName = useAppStore((s) => s.displayName)
  const setDisplayName = useAppStore((s) => s.setDisplayName)
  const prejoin = useAppStore((s) => s.prejoin)
  const setPrejoin = useAppStore((s) => s.setPrejoin)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The preview box takes the camera's REAL shape (see PREVIEW_* below). Starts at
  // 4:3 — the most common webcam mode, and a middle ground that barely moves when
  // the true ratio lands, instead of the 16:9→4:3 lurch a landscape default gives.
  const [previewAspect, setPreviewAspect] = useState(4 / 3)
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
        // Shape the box to the camera before the first frame paints, so the
        // preview doesn't visibly resize under the user. getSettings() knows the
        // negotiated mode immediately; `onResize` on the element is the backstop
        // for browsers that report nothing here (and for a mid-preview change).
        const s = stream.getVideoTracks()[0]?.getSettings()
        if (s?.width && s?.height) setPreviewAspect(clampAspect(s.width / s.height))
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

  // Backstop for the aspect read in `start()`: a browser whose getSettings()
  // reports nothing useful, and a camera that renegotiates mid-preview. Bound
  // imperatively rather than via React's onResize — `resize` on a media element
  // is a DOM event, and wiring it here keeps it working regardless of which
  // media events the React version in use happens to attach.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !cameraOn) return
    const read = () => {
      if (v.videoWidth && v.videoHeight) setPreviewAspect(clampAspect(v.videoWidth / v.videoHeight))
    }
    v.addEventListener('resize', read)
    v.addEventListener('loadedmetadata', read)
    read()
    return () => {
      v.removeEventListener('resize', read)
      v.removeEventListener('loadedmetadata', read)
    }
  }, [cameraOn])

  const canJoin = displayName.trim().length > 0

  // Free the preview camera the instant Join is tapped, before LiveKit acquires
  // it on connect. On mobile a camera can't be opened twice at once — the overlap
  // (preview still live while the call grabs it) is what flickered/blacked the
  // first in-call frame. The unmount cleanup also stops it, but releasing here
  // gives the OS a head start.
  const join = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    onJoin()
  }

  return (
    // items-start + scroll so a tall card on a short phone stays reachable
    // (items-center would strand the top off-screen with no way to scroll).
    <main className="min-h-dvh flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <Island pad="none" className="my-auto w-full max-w-lg p-4 sm:p-6 short:p-3 sm:short:p-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-field py-1 pr-2 text-sm text-ink-muted hover:text-ink [&_svg]:size-4"
        >
          <ChevronLeftIcon />
          Back
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-subtle">Joining</p>
            <h1 className="truncate text-xl font-semibold short:text-lg">{prettyRoom(room)}</h1>
          </div>
          {/* Share the invite before joining — host can pull people in from the
              green room. The current URL already carries the invite secret + E2EE
              key in its #fragment, so it's the full link. */}
          <IconButton
            label={copied ? 'Invite link copied' : 'Share invite link'}
            icon={copied ? <CheckIcon /> : <ShareIcon />}
            tone="neutral"
            className="mt-0.5 shrink-0"
            onClick={() => void share({ title: APP_NAME, text: `Join my call on ${APP_NAME}` })}
          />
        </div>

        {/* The box takes the CAMERA's shape, not a device guess. This screen answers
            one question — "what will everyone else see?" — and a fixed 3:4 / 16:9 box
            with object-cover answered it wrongly: it cropped a 4:3 webcam's sides off,
            so the user approved a framing they were never actually shown.
            Sizing it from the stream means no crop AND no letterbox bars: the box IS
            the frame. Height still caps (--pv-h) so the preview can't push the name
            field and Join off a short viewport — the original cause of pre-join
            scrolling — and the paired max-width keeps the box tight to the video when
            that cap binds, instead of leaving pillarbox bars at full width. */}
        <div
          className="mx-auto mt-3 w-full overflow-hidden rounded-tile bg-sunken [--pv-h:32dvh] [--pv-w:20rem] short:mt-2 short:[--pv-h:26dvh] pointer-fine:mt-4 pointer-fine:[--pv-h:34dvh] pointer-fine:[--pv-w:100%]"
          style={{
            aspectRatio: String(previewAspect),
            maxHeight: 'var(--pv-h)',
            maxWidth: `min(var(--pv-w), calc(var(--pv-h) * ${previewAspect}))`,
          }}
        >
          {cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              // contain, not cover: if the ratio is ever clamped (a freak ultrawide)
              // the frame is shown whole rather than trimmed to fit.
              className="size-full object-contain [transform:scaleX(-1)]"
            />
          ) : (
            <div className="grid size-full place-items-center text-sm text-ink-subtle">
              {prejoin.lowBandwidth ? 'Audio-only / low bandwidth' : 'Camera off'}
            </div>
          )}
        </div>

        {/* Device toggles sit below the preview (not floating over it) so the
            keyboard never covers them once the name field is focused. */}
        <div className="mt-3 flex justify-center gap-3 short:mt-2">
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

        {error && <p className="mt-2 text-sm text-danger-text">{error}</p>}

        <div className="mt-3 flex flex-col gap-2.5 sm:mt-4 sm:gap-3 short:mt-2 short:gap-2 sm:short:mt-2 sm:short:gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              // Enter = the primary action (Join), the expected keyboard flow.
              if (e.key === 'Enter' && canJoin) {
                e.preventDefault()
                join()
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

          {/* E2EE is keyed by the invite link (#e), not a typed passphrase — a
              strong random key everyone gets automatically by opening the link.
              Show it as a read-only assurance rather than asking for input. */}
          {encrypted && (
            <p className="flex items-center gap-1.5 rounded-field bg-sunken px-3 py-2 text-xs text-ink-muted [&_svg]:size-3.5 [&_svg]:text-success">
              <LockIcon />
              End-to-end encrypted — secured by your invite link.
            </p>
          )}

          <Button variant="accent" size="lg" block disabled={!canJoin} onClick={join}>
            Join now
          </Button>

          {/* Turn the (unstated) no-recording fact into trust, and disclose what
              the camera/mic are for — the audit's L3. */}
          <p className="text-center text-xs text-ink-subtle">
            Your camera and mic let others see and hear you. {APP_NAME} doesn't record calls.{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">
              Privacy
            </Link>
          </p>
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
    <div className="mt-3 flex items-center gap-3 short:mt-2">
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
