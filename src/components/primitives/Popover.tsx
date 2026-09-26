import * as RP from '@radix-ui/react-popover'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Modal traps focus and blocks pointer events on the rest of the page while open
   * (outside tap still dismisses). Needed for a touch popover floating over the
   * chat timeline so a swipe inside it can't reach the message rows behind it.
   */
  modal?: boolean
  className?: string
  /** The panel's accessible name. Default: whatever the trigger is called, so a
   *  screen reader says "More options, dialog" rather than an unnamed dialog. */
  label?: string
}

/** Anchored transient panel (More menu, device pickers). Radix handles a11y. */
export function Popover({
  trigger,
  children,
  side = 'top',
  align = 'center',
  open,
  onOpenChange,
  modal = false,
  className,
  label,
}: PopoverProps) {
  const triggerId = useId()
  return (
    <RP.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RP.Trigger asChild id={triggerId}>
        {trigger}
      </RP.Trigger>
      <RP.Portal>
        <RP.Content
          side={side}
          align={align}
          sideOffset={10}
          aria-label={label}
          aria-labelledby={label ? undefined : triggerId}
          className={cn(
            'z-50 min-w-44 rounded-island bg-raised text-ink shadow-pop border border-line p-2 mn-pop',
            'focus:outline-none',
            className,
          )}
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  )
}
