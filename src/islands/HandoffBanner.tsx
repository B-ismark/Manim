import { useState } from 'react'
import { Island, Button } from '@/components/primitives'

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
    <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-30 flex justify-center px-4">
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
            Use only this device
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Keep both
          </Button>
        </div>
      </Island>
    </div>
  )
}
