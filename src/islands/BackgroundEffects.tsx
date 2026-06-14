import { Slider, Toggle } from '@/components/primitives'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'

/** Tier-2 background effects: blur toggle + live radius slider. */
export function BackgroundEffects({ controls }: { controls: BackgroundBlurControls }) {
  const { supported, enabled, setEnabled, radius, setRadius } = controls

  if (!supported) {
    return (
      <p className="px-2.5 py-2 text-xs text-ink-subtle">
        Background blur isn't supported on this browser.
      </p>
    )
  }

  // Slider doubles as the on/off control: dragging to 0 disables blur,
  // dragging up from 0 re-enables it.
  function onSlide(v: number) {
    if (v <= 0) {
      setEnabled(false)
      return
    }
    setRadius(v)
    if (!enabled) setEnabled(true)
  }

  return (
    <div className="px-2.5 py-1.5">
      <Toggle
        checked={enabled}
        onCheckedChange={setEnabled}
        label="Background blur"
        className="w-full justify-between"
      />
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-ink-muted">
          <span>Blur strength</span>
          <span className="tabular-nums">{enabled ? radius : 0}</span>
        </div>
        <Slider
          value={enabled ? radius : 0}
          onValueChange={onSlide}
          min={0}
          max={25}
          step={1}
          label="Blur strength (0 turns blur off)"
        />
      </div>
    </div>
  )
}
