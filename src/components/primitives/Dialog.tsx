import * as RD from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Hide the visible title but keep it for screen readers. */
  hideTitle?: boolean
  description?: string
  children: ReactNode
  className?: string
}

/** Modal dialog over the scrim. Radix handles focus trap + Esc + ARIA. */
export function Dialog({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  children,
  className,
}: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-scrim mn-pop" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
            'bg-surface text-ink rounded-island shadow-raised p-6 mn-pop',
            'focus:outline-none',
            className,
          )}
        >
          <RD.Title className={cn('text-lg font-semibold', hideTitle && 'sr-only')}>{title}</RD.Title>
          {description ? (
            <RD.Description className="mt-1 text-sm text-ink-muted">{description}</RD.Description>
          ) : null}
          <div className={cn(!hideTitle && 'mt-4')}>{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
