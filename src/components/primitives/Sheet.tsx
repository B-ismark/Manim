import * as RD from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /**
   * `responsive` (default) = bottom sheet on mobile, right-docked island on desktop.
   * `right` / `bottom` force a single side.
   */
  side?: 'right' | 'bottom' | 'responsive'
  /** When true, the body is a bare flex column (child owns padding + scroll) — e.g. chat. */
  flush?: boolean
  /** When true, only the close button shows in the header; title is ARIA-only. */
  hideTitle?: boolean
  className?: string
}

const sideClass: Record<NonNullable<SheetProps['side']>, string> = {
  right: 'right-3 top-3 bottom-3 w-[min(92vw,22rem)] rounded-island',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-island',
  responsive:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-island ' +
    'md:inset-x-auto md:right-3 md:top-3 md:bottom-3 md:w-[min(92vw,22rem)] md:max-h-none md:rounded-island',
}

/**
 * Slide-in panel for chat / participants / settings. Bottom sheet on mobile,
 * docked island on desktop — one component (STYLE.md §4). Radix Dialog gives
 * focus trap + Esc + ARIA.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = 'responsive',
  flush = false,
  hideTitle = false,
  className,
}: SheetProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-scrim mn-pop md:bg-transparent" />
        <RD.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-ink shadow-raised focus:outline-none',
            sideClass[side],
            className,
          )}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            {hideTitle ? (
              <RD.Title asChild>
                <VisuallyHidden>{title}</VisuallyHidden>
              </RD.Title>
            ) : (
              <RD.Title className="text-sm font-semibold">{title}</RD.Title>
            )}
            <RD.Close
              aria-label="Close panel"
              className="ml-auto rounded-control p-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </RD.Close>
          </header>
          <RD.Description asChild>
            <VisuallyHidden>{title} panel</VisuallyHidden>
          </RD.Description>
          <div className={cn(flush ? 'flex min-h-0 flex-1 flex-col' : 'flex-1 overflow-y-auto p-4')}>
            {children}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
