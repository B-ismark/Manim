import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, IconButton, Island, Toggle } from '@/components/primitives'
import { CameraIcon, CameraOffIcon, CheckIcon, ChevronLeftIcon, LockIcon, MicIcon, MicOffIcon, ShareIcon } from '@/components/icons'
import { useAppStore } from '@/store/useAppStore'
import { prettyRoom } from '@/lib/roomName'
import { useShareLink } from '@/lib/useShareLink'
import { useElementSize } from '@/lib/useElementSize'
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

  // Size the preview box to the largest rectangle of the camera's OWN aspect that
  // fits the space the layout leaves it.
  //
  // Deliberately measured rather than left to CSS. `aspect-ratio` with `max-width`
  // and `max-height` looks like it should do this, but the clamps apply to one axis
  // at a time: once max-width binds, the browser keeps the height it already
  // computed and the box quietly stops matching the camera — which is the exact
  // failure this screen exists to avoid, and it showed up as an 8% aspect error the
  // moment the box had a flexible container instead of a fixed dvh cap.
  const { ref: stageRef, size: stage } = useElementSize<HTMLDivElement>()
  const previewBox =
    stage.width > 0 && stage.height > 0
      ? stage.width / stage.height > previewAspect
        ? { w: stage.height * previewAspect, h: stage.height }
        : { w: stage.width, h: stage.width / previewAspect }
      : { w: 0, h: 0 }

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
    // The card fills the viewport height (capped, so it doesn't sprawl on a big
    // desktop) and lays out as a column: fixed chrome, fixed footer, and the preview
    // taking everything left over. That is the whole point of this change — the
    // preview used to be capped at a fixed 32dvh, so it stayed the same small size no
    // matter how much room there was, while nine rows of secondary chrome had the rest.
    // overflow-y-auto survives as a backstop only: if a translation or a huge font
    // setting overflows the footer, the card scrolls rather than stranding Join.
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-4">
      <Island
        pad="none"
        className="flex h-full max-h-[46rem] w-full max-w-lg flex-col p-4 sm:p-6 short:p-3 sm:short:p-4"
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          className="-ml-1 mb-2 inline-flex shrink-0 items-center gap-1 rounded-field py-1 pr-2 text-sm text-ink-muted hover:text-ink [&_svg]:size-4"
        >
          <ChevronLeftIcon />
          Back
        </button>
        <div className="flex shrink-0 items-start justify-between gap-3">
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
            the frame. What changed is where the size comes from — `flex-1` against the
            card instead of a fixed `32dvh`, with max-width/height keeping the box tight
            to the video so a tall or wide camera still fills what it can without bars. */}
        <div
          ref={stageRef}
          className="mt-3 flex min-h-0 flex-1 items-center justify-center short:mt-2 pointer-fine:mt-4"
        >
          <div
            className="relative overflow-hidden rounded-tile bg-sunken"
            style={{ width: previewBox.w, height: previewBox.h }}
          >
            {cameraOn ? (
              <video
                ref={videoRef}
                data-testid="prejoin-preview"
                autoPlay
                muted
                playsInline
                // contain, not cover: if the ratio is ever clamped (a freak ultrawide)
                // the frame is shown whole rather than trimmed to fit.
                className="size-full object-contain [transform:scaleX(-1)]"
              />
            ) : (
              <div className="grid size-full place-items-center px-4 text-center text-sm text-ink-subtle">
                {prejoin.lowBandwidth ? 'Audio-only / low bandwidth' : 'Camera off'}
              </div>
            )}
          </div>
        </div>

        {showPriming && (
          <div className="mt-3 shrink-0 rounded-field bg-sunken p-3 text-center">
            <p className="text-sm text-ink">
              We'll ask for camera and microphone access so others can see and hear you.
            </p>
            <Button variant="accent" className="mt-2" disabled={priming} onClick={requestAccess}>
              {priming ? 'Requesting…' : 'Allow camera & microphone'}
            </Button>
          </div>
        )}

        {error && <p className="mt-2 shrink-0 text-sm text-danger-text">{error}</p>}

        {/* Three footer rows, down from nine.
            The rows themselves are what was squeezing the preview: device toggles,
            mic level and speaker test each had a full-width row of their own, and so
            did low-bandwidth, the encryption assurance and the privacy line. Merging
            them is what frees the vertical space the preview now takes — raising the
            old cap on its own would just have re-introduced the page scroll the cap
            was added to prevent. */}
        <div className="mt-3 flex shrink-0 flex-col gap-2.5 sm:mt-4 sm:gap-3 short:mt-2 short:gap-2">
          {/* Row 1 — everything about your devices, on one line. */}
          <div className="flex items-center gap-2.5">
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
            {permission !== 'prompt' && permission !== 'denied' && (
              <MicSpeakerTest micEnabled={prejoin.micEnabled} />
            )}
          </div>

          {/* Row 2 — who you are, then the way in. */}
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
            className="h-11 shrink-0 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />

          <Button variant="accent" size="lg" block disabled={!canJoin} onClick={join}>
            Join now
          </Button>

          {/* Row 3 — the things almost nobody changes, and the assurances. Low-bandwidth
              keeps a real labelled switch (it is a control), but it shares its line with
              the encryption and no-recording facts instead of owning three rows. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p className="flex items-center gap-1.5 text-xs text-ink-subtle [&_svg]:size-3.5 [&_svg]:text-success">
              {/* E2EE is keyed by the invite link (#e), not a typed passphrase — a
                  strong random key everyone gets automatically by opening the link.
                  Shown as a read-only assurance rather than asking for input. */}
              {encrypted && (
                <>
                  <LockIcon />
                  <span>Encrypted</span>
                  <span aria-hidden className="opacity-50">
                    ·
                  </span>
                </>
              )}
              {/* Turn the (unstated) no-recording fact into trust, and disclose what
                  the camera/mic are for — the audit's L3. */}
              <span>{APP_NAME} doesn’t record calls</span>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">
                Privacy
              </Link>
            </p>
            <Toggle
              checked={prejoin.lowBandwidth}
              onCheckedChange={(v) =>
                setPrejoin({ lowBandwidth: v, cameraEnabled: v ? false : prejoin.cameraEnabled })
              }
              label="Low-bandwidth"
            />
          </div>
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
    <>
      <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <Button type="button" variant="neutral" size="sm" className="shrink-0" onClick={testSpeaker}>
        Test speaker
      </Button>
    </>
  )
}
