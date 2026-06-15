import { useConnectionQualityIndicator, useLocalParticipant } from '@livekit/components-react'
import { ConnectionQuality as Quality } from 'livekit-client'
import { LockIcon } from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { cn } from '@/lib/cn'

export interface CallStatusBarProps {
  /** True when E2EE is active for this room (a passphrase was set at prejoin). */
  encrypted: boolean
  /** Hidden alongside the rest of the chrome on mobile tap-to-hide. */
  visible: boolean
}

/**
 * Persistent trust + health chip, top-center. Shows an end-to-end-encryption
 * badge (when active) and live connection quality — the WhatsApp/Telegram
 * convention. Non-interactive; taps pass through to the stage gesture layer.
 */
export function CallStatusBar({ encrypted, visible }: CallStatusBarProps) {
  const { localParticipant } = useLocalParticipant()
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant })
  const poor = quality === Quality.Poor || quality === Quality.Lost

  // Nothing worth showing: good connection and no encryption badge.
  if (!encrypted && !poor) return null

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex justify-center px-4',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && '-translate-y-[150%] opacity-0',
      )}
    >
      <div className="flex items-center gap-2 rounded-control bg-overlay px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
        {encrypted && (
          <span className="flex items-center gap-1" title="End-to-end encrypted">
            <LockIcon className="size-3.5" />
            <span>Encrypted</span>
          </span>
        )}
        {encrypted && poor && <span className="h-3 w-px bg-white/30" aria-hidden />}
        {poor && (
          <span className="flex items-center gap-1.5">
            <ConnectionQuality participant={localParticipant} />
            <span>{quality === Quality.Lost ? 'Connection lost' : 'Weak connection'}</span>
          </span>
        )}
      </div>
    </div>
  )
}
