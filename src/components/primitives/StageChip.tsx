import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * Floating pill used for on-stage chrome controls (layout, participants, exit
 * fullscreen). One source for the overlay-pill look + a ≥44px touch target
 * (WCAG 2.5.5 / Apple HIG), so the interactive top-corner chips are reliably
 * tappable on phones. Non-interactive status (the call timer) keeps its own
 * lighter styling.
 */
export function StageChip({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-control bg-overlay px-3 text-sm font-medium text-white shadow-raised backdrop-blur',
        'transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-4',
        className,
      )}
      {...rest}
    />
  )
}
