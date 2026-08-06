import { useState } from 'react'
import { Island, Button } from '@/components/primitives'

/**
 * Persistent bar shown while this device is a muted COMPANION (the same account is in
 * the call on another device and the user chose "join anyway"). Mic, camera, and speaker
 * are off to avoid echo. "Turn on sound" clears companion (unmutes the speaker; the user
 * re-enables mic/camera from the control bar); "Transfer here" moves the call to this
 * device and drops the other. Stays visible — it's a mode indicator, not a dismissible
 * notice. STYLE.md island model.
 */
export function CompanionBanner({
  onTakeOver,
  onTransfer,
}: {
  onTakeOver: () => void
  onTransfer: () => void
}) {
  return (
    <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
      <p className="text-sm text-ink">
        Companion — audio off
        <span className="block text-xs text-ink-subtle">
          You're in this call on another device.
        </span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="accent" onClick={onTakeOver}>
          Turn on sound
        </Button>
        <Button size="sm" variant="ghost" onClick={onTransfer}>
          Transfer here
        </Button>
      </div>
    </Island>
  )
}

/**
 * Shown when the same signed-in user is live on another device (simultaneous
 * multi-device). Both sessions stay connected by default — "Keep both" just
 * dismisses. "Use only this device" hands off: drops your other session. The
 * echo hint covers the co-located case (two devices, one room, mics open).
 * STYLE.md island model.
 */
export function HandoffBanner({ onSwitch }: { onSwitch: () => void }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
      <p className="text-sm text-ink">
        You're in this call on another device.
        <span className="block text-xs text-ink-subtle">
          Both stay connected — mute one to avoid echo if they're side by side.
        </span>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            onSwitch()
            setDismissed(true)
          }}
        >
          Transfer to this device
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Keep both
        </Button>
      </div>
    </Island>
  )
}
