import { useEffect, useRef, useState } from 'react'
import { useConnectionQualityIndicator, useLocalParticipant } from '@livekit/components-react'
import { ConnectionQuality as Quality } from 'livekit-client'
import { LockIcon } from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { cn } from '@/lib/cn'

export interface CallStatusBarProps {
  /** True only when E2EE is ACTUALLY active (room.setE2EEEnabled resolved), not
   *  merely when a passphrase was typed — the badge must never overstate security. */
  encrypted: boolean
  /** Hidden alongside the rest of the chrome on mobile tap-to-hide. */
  visible: boolean
}

/** mm:ss, or h:mm:ss past an hour. */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** Live call duration since the local participant joined (ticks every second). */
function useCallTimer(): string {
  const { localParticipant } = useLocalParticipant()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // joinedAt reflects the true call start (survives reconnects); fall back to
  // first render before the roster settles.
  const startedAt = localParticipant.joinedAt?.getTime() ?? now
  return formatElapsed(Math.floor((now - startedAt) / 1000))
}

/** Poor must hold before we warn. */
const POOR_HOLD_MS = 5000

/**
 * Debounced weak-connection signal. `Lost` surfaces instantly (a real drop, not
 * noise), but `Poor` must persist {@link POOR_HOLD_MS} before we warn — many
 * regions (e.g. West Africa → the nearest LiveKit edge in Marseille, ~150ms RTT)
 * sit at a latency that LiveKit buckets as `Poor` yet calls fine. Without the
 * hold the chip flashes "Weak connection" at a perfectly usable baseline.
 * Recovery clears the warning immediately.
 */
function useDebouncedPoor(quality: Quality): boolean {
  const [warn, setWarn] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const clear = () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current)
        timer.current = undefined
      }
    }
    if (quality === Quality.Lost) {
      clear()
      setWarn(true)
    } else if (quality === Quality.Poor) {
      // Start the hold only if one isn't already pending and we aren't warning.
      if (timer.current === undefined && !warn) {
        timer.current = window.setTimeout(() => {
          timer.current = undefined
          setWarn(true)
        }, POOR_HOLD_MS)
      }
    } else {
      // Good / Excellent / Unknown → recovered: drop the warning at once.
      clear()
      setWarn(false)
    }
    return clear
  }, [quality, warn])

  return warn
}

/**
 * Persistent status chip, top-center (WhatsApp/Telegram convention): the call
 * timer always, plus an end-to-end-encryption badge and weak-connection warning
 * when relevant. Non-interactive; taps pass through to the stage gesture layer.
 */
export function CallStatusBar({ encrypted, visible }: CallStatusBarProps) {
  const { localParticipant } = useLocalParticipant()
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant })
  const poor = useDebouncedPoor(quality)
  const elapsed = useCallTimer()

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-20 flex justify-center px-4',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && '-translate-y-[150%] opacity-0',
      )}
    >
      <div className="flex min-h-11 items-center gap-2 rounded-control bg-overlay px-3 text-xs font-medium text-white backdrop-blur">
        {encrypted && <LockIcon className="size-3.5" aria-label="End-to-end encrypted" />}
        <span className="tabular-nums" aria-label="Call duration">
          {elapsed}
        </span>
        {poor && (
          <>
            <span className="h-3 w-px bg-white/30" aria-hidden />
            <span className="flex items-center gap-1.5">
              <ConnectionQuality participant={localParticipant} />
              {/* Label only where there's room — the bars carry the meaning on
                  narrow phones (avoids the top pill overflowing). */}
              <span className="hidden min-[380px]:inline">
                {quality === Quality.Lost ? 'Connection lost' : 'Weak connection'}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
