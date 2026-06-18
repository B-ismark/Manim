import { useConnectionQualityIndicator } from '@livekit/components-react'
import { ConnectionQuality as Quality } from 'livekit-client'
import type { Participant } from 'livekit-client'
import { cn } from '@/lib/cn'

interface QualityMeta {
  filled: number
  label: string
  color: string
}

const META: Record<Quality, QualityMeta> = {
  [Quality.Excellent]: { filled: 3, label: 'Excellent connection', color: 'bg-success' },
  [Quality.Good]: { filled: 2, label: 'Good connection', color: 'bg-success' },
  [Quality.Poor]: { filled: 1, label: 'Poor connection', color: 'bg-warning' },
  [Quality.Lost]: { filled: 0, label: 'Connection lost', color: 'bg-danger' },
  [Quality.Unknown]: { filled: 0, label: 'Connection unknown', color: 'bg-ink-subtle' },
}

export interface ConnectionQualityProps {
  participant?: Participant
  className?: string
  /**
   * Only render when the connection has actually degraded (Poor/Lost). A healthy
   * signal shows nothing — the bars are a *warning*, not always-on chrome, which
   * is how Meet/Teams/Zoom treat the indicator (and what users expect).
   */
  degradedOnly?: boolean
}

/**
 * Three-bar signal strength indicator. Meaning is paired with a text label
 * (title + aria-label), never color alone (STYLE.md §6).
 */
export function ConnectionQuality({ participant, className, degradedOnly }: ConnectionQualityProps) {
  const { quality } = useConnectionQualityIndicator({ participant })
  const meta = META[quality] ?? META[Quality.Unknown]
  const degraded = quality === Quality.Poor || quality === Quality.Lost

  // Healthy (or not-yet-known) connection in degraded-only mode → render nothing.
  if (degradedOnly && !degraded) return null

  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className={cn('inline-flex items-end gap-[3px] px-0.5', className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            'w-1.5 rounded-sm transition-colors duration-[var(--dur-fast)]',
            i === 0 ? 'h-2' : i === 1 ? 'h-3' : 'h-4',
            i < meta.filled ? meta.color : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  )
}
