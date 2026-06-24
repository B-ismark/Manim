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
            'fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col lg:w-[min(90vw,38rem)]',
            // Bound to the viewport so tall bodies (effects preview + controls)
            // never run off a short screen with no way to scroll. Title/desc stay
            // pinned; only the body scrolls.
            'max-h-[88dvh] bg-surface text-ink rounded-island shadow-raised p-5 mn-pop sm:p-6',
            'focus:outline-none',
            className,
          )}
        >
          {/* Always-present close button (top-right). Radix also closes on Esc /
              overlay, but a visible affordance is expected on touch + by anyone
              who doesn't know the shortcut. Sits above the title row. */}
          <RD.Close
            aria-label="Close"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </RD.Close>
          <RD.Title className={cn('shrink-0 pr-8 text-lg font-semibold', hideTitle && 'sr-only')}>{title}</RD.Title>
          {description ? (
            <RD.Description className="mt-1 shrink-0 text-sm text-ink-muted">{description}</RD.Description>
          ) : null}
          {/* px-1/-mx-1: overflow-y-auto forces overflow-x to clip too, which would
              shear the 2px focus ring off any input sitting at the body edge. The
              padding gives the ring room; the negative margin keeps content aligned. */}
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 -mx-1 no-scrollbar',
              !hideTitle && 'mt-4',
            )}
          >
            {children}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
