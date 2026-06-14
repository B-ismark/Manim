import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Elevation = 'island' | 'raised' | 'pop'
type Pad = 'none' | 'sm' | 'md' | 'lg'

const padClass: Record<Pad, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

const shadowClass: Record<Elevation, string> = {
  island: 'shadow-island',
  raised: 'shadow-raised',
  pop: 'shadow-pop',
}

export interface IslandProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation
  pad?: Pad
  /** Hairline border for definition on busy backgrounds. */
  bordered?: boolean
}

/**
 * The floating panel shell. Every discrete surface that sits on the stage
 * should be an <Island> — never re-implement radius/shadow/surface. See STYLE.md §2.
 */
export const Island = forwardRef<HTMLDivElement, IslandProps>(function Island(
  { elevation = 'island', pad = 'md', bordered = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-surface text-ink rounded-island',
        shadowClass[elevation],
        bordered && 'border border-line',
        padClass[pad],
        className,
      )}
      {...rest}
    />
  )
})
