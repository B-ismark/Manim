import { useLocalParticipant, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Dialog, Slider, Toggle } from '@/components/primitives'
import { BanIcon, CameraOffIcon } from '@/components/icons'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import { useRoomStore } from '@/store/useRoomStore'
import { isLowPowerDevice } from '@/lib/device'
import { cn } from '@/lib/cn'

/**
 * Effects in their own dialog (not crammed in the More menu) so the live preview
 * gets real estate — you see blur / a virtual background applied before
 * committing. Same picker on web + mobile.
 */
export function EffectsDialog({
  open,
  onOpenChange,
  controls,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  controls: BackgroundBlurControls
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Background blur"
      description="Blur your background. Changes preview live before they apply."
    >
      <BackgroundEffects controls={controls} previewSize="lg" />
    </Dialog>
  )
}

/**
 * Background blur picker: none / blur, with a blur-strength slider and a
 * high-quality toggle when blur is active. (Image replacement was removed — it
 * kept breaking the live feed; blur is the reliable effect.)
 */
export function BackgroundEffects({
  controls,
  previewSize = 'sm',
}: {
  controls: BackgroundBlurControls
  /** 'lg' gives the live preview more height — used in the dedicated dialog. */
  previewSize?: 'sm' | 'lg'
}) {
  const {
    supported,
    busy,
    mode,
    radius,
    setRadius,
    quality,
    setQuality,
    allowHighQuality,
    useNone,
    useBlur,
  } = controls
  const { localParticipant, isCameraEnabled } = useLocalParticipant()

  if (!supported) {
    return (
      <p className="px-2.5 py-2 text-xs text-ink-subtle">
        Background effects aren't supported on this browser.
      </p>
    )
  }

  const lowPower = isLowPowerDevice()
  const selfFacing = useRoomStore((s) => s.selfFacing)
  const camPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const previewRef = camPub
    ? ({ participant: localParticipant, source: Track.Source.Camera, publication: camPub } as TrackReferenceOrPlaceholder)
    : null

  return (
    <div className="px-2.5 py-1.5">
      {/* Live self-preview so the choice is visible before it's applied (the
          processor is already on the published track, so the effect shows here
          in real time). Mirrored like the stage self-view. */}
      <div
        className={cn(
          'relative mb-3 w-full overflow-hidden rounded-tile bg-sunken',
          previewSize === 'lg' ? 'aspect-video max-h-[40vh]' : 'aspect-video',
        )}
      >
        {isCameraEnabled && previewRef ? (
          <VideoTrack
            trackRef={previewRef as Parameters<typeof VideoTrack>[0]['trackRef']}
            className={cn('size-full object-cover', selfFacing === 'user' && '[transform:scaleX(-1)]')}
          />
        ) : (
          <div className="grid size-full place-items-center gap-1 text-center text-xs text-ink-subtle [&_svg]:size-5">
            <CameraOffIcon />
            Turn on your camera to preview effects
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-overlay/40 backdrop-blur-sm">
            <span
              className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white"
              role="status"
              aria-label="Applying effect"
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Thumb label="None" selected={mode === 'none'} onClick={useNone}>
          <span className="grid size-full place-items-center text-ink-muted [&_svg]:size-5">
            <BanIcon />
          </span>
        </Thumb>

        <Thumb label="Blur" selected={mode === 'blur'} onClick={useBlur}>
          {/* A frosted preview — evokes blur without running the processor. */}
          <span className="size-full bg-gradient-to-br from-ink-subtle to-line-strong blur-[1.5px]" />
        </Thumb>
      </div>

      {lowPower && (
        <p className="mt-2 text-xs text-ink-subtle">Uses more battery on this device.</p>
      )}

      {mode === 'blur' && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs text-ink-muted">
            <span>Blur strength</span>
            <span className="tabular-nums">{radius}</span>
          </div>
          <Slider value={radius} onValueChange={setRadius} min={1} max={25} step={1} label="Blur strength" />

          {allowHighQuality && (
            <div className="mt-3">
              <Toggle
                checked={quality === 'high'}
                onCheckedChange={(v) => setQuality(v ? 'high' : 'standard')}
                label="High quality"
                className="w-full justify-between"
              />
              <p className="mt-1 text-xs text-ink-subtle">Sharper edges. Uses more power.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Square selectable preview tile with a label underneath. */
function Thumb({
  label,
  selected,
  onClick,
  children,
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="flex flex-col items-center gap-1">
      <span
        className={cn(
          'size-14 overflow-hidden rounded-tile bg-sunken ring-2 transition-[box-shadow]',
          selected ? 'ring-accent' : 'ring-transparent',
        )}
      >
        {children}
      </span>
      <span className={cn('text-[11px] leading-none', selected ? 'text-accent' : 'text-ink-muted')}>{label}</span>
    </button>
  )
}
