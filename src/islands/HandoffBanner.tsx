import { useState } from 'react'
import { Island, Button } from '@/components/primitives'

/**
 * Shown when the same display name is present on another device (multi-device).
 * "Use only this device" drops the other session; "Keep both" dismisses and
 * leaves both connected. STYLE.md island model.
 */
export function HandoffBanner({ onSwitch }: { onSwitch: () => void }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-30 flex justify-center px-4">
      <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
        <p className="text-sm text-ink">You're in this call on another device.</p>
        <div className="flex gap-2">
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
