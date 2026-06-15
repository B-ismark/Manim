import { useRef } from 'react'
import { useLocalParticipant, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Slider, Toggle } from '@/components/primitives'
import { BanIcon, CameraOffIcon } from '@/components/icons'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import { isLowPowerDevice } from '@/lib/device'
import { cn } from '@/lib/cn'

/**
 * Background effects picker: none / blur / preset images / custom upload —
 * a thumbnail strip (the Teams/Meet convention), with a blur-strength slider
 * and a high-quality toggle when blur is active.
 */
export function BackgroundEffects({ controls }: { controls: BackgroundBlurControls }) {
  const {
    supported,
    mode,
    radius,
    setRadius,
    quality,
    setQuality,
    allowHighQuality,
    selectedImage,
    presets,
    customImage,
    useNone,
    useBlur,
    selectImage,
    addCustomImage,
  } = controls
  const fileRef = useRef<HTMLInputElement>(null)
  const { localParticipant, isCameraEnabled } = useLocalParticipant()

  if (!supported) {
    return (
      <p className="px-2.5 py-2 text-xs text-ink-subtle">
        Background effects aren't supported on this browser.
      </p>
    )
  }

  const lowPower = isLowPowerDevice()
  const imageSelected = (src: string) => mode === 'image' && selectedImage === src
  const camPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const previewRef = camPub
    ? ({ participant: localParticipant, source: Track.Source.Camera, publication: camPub } as TrackReferenceOrPlaceholder)
    : null

  return (
    <div className="px-2.5 py-1.5">
      {/* Live self-preview so the choice is visible before it's applied (the
          processor is already on the published track, so the effect shows here
          in real time). Mirrored like the stage self-view. */}
      <div className="mb-3 aspect-video w-full overflow-hidden rounded-tile bg-sunken">
        {isCameraEnabled && previewRef ? (
          <VideoTrack
            trackRef={previewRef as Parameters<typeof VideoTrack>[0]['trackRef']}
            className="size-full object-cover [transform:scaleX(-1)]"
          />
        ) : (
          <div className="grid size-full place-items-center gap-1 text-center text-xs text-ink-subtle [&_svg]:size-5">
            <CameraOffIcon />
            Turn on your camera to preview effects
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

        {presets.map((p) => (
          <Thumb
            key={p.id}
            label={p.label}
            selected={imageSelected(p.src)}
            onClick={() => selectImage(p.src)}
          >
            <span
              className="size-full bg-cover bg-center"
              style={{ backgroundImage: `url(${p.src})` }}
            />
          </Thumb>
        ))}

        {customImage && (
          <Thumb label="Custom" selected={imageSelected(customImage)} onClick={() => selectImage(customImage)}>
            <span
              className="size-full bg-cover bg-center"
              style={{ backgroundImage: `url(${customImage})` }}
            />
          </Thumb>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Upload a background image"
          className="flex flex-col items-center gap-1"
        >
          <span className="grid size-14 place-items-center rounded-tile border border-dashed border-line-strong text-ink-muted hover:bg-sunken [&_svg]:size-5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-[11px] leading-none text-ink-muted">Upload</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) addCustomImage(file)
            e.target.value = ''
          }}
        />
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
