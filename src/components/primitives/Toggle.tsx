import * as RS from '@radix-ui/react-switch'
import { useId } from 'react'
import { cn } from '@/lib/cn'

export interface ToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  /**
   * Second line under the label — what the setting does, when the name alone
   * doesn't say. Kept inside the <label> so it's part of the tap target rather
   * than text beside it: on a touch row the switch alone is only 24px tall, and the
   * label is what makes the row clear the 44px guidance.
   */
  hint?: string
  /** Hide the visible label (still read by screen readers). */
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

/** On/off switch (Radix Switch) — token-styled. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  hideLabel = false,
  disabled = false,
  className,
}: ToggleProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {!hideLabel && (
        <label htmlFor={id} className="min-w-0 select-none">
          <span className="block text-sm text-ink">{label}</span>
          {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
        </label>
      )}
      <RS.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-control transition-colors duration-[var(--dur-fast)]',
          'bg-line data-[state=checked]:bg-accent disabled:opacity-50',
        )}
      >
        <RS.Thumb
          className={cn(
            // accent-ink is a fixed near-white in every theme, so the knob stays
            // visible on the dark OFF-track in dark mode (a plain surface fill sinks).
            'block size-5 translate-x-0.5 rounded-control bg-accent-ink shadow-pop',
            'transition-transform duration-[var(--dur-fast)] ease-[var(--ease-snap)]',
            'data-[state=checked]:translate-x-[1.375rem]',
          )}
        />
      </RS.Root>
    </div>
  )
}
