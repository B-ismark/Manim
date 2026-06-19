import * as RD from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
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
  /**
   * Modal (default) traps focus, scrims + inerts the rest of the page, and closes
   * on outside click — right for a true dialog (Settings, GIF, More) and the
   * mobile bottom sheet. Set false for the desktop DOCKED panel (chat / people):
   * the call must stay fully operable beside it — you have to be able to mute,
   * stop video, or leave while chat is open, and assistive tech must still reach
   * the control bar (a modal sheet `aria-hidden`s it). Non-modal stays open while
   * you click the stage / controls; Esc still closes it.
   */
  modal?: boolean
  /**
   * Mobile only: show a drag handle and let the user drag the bottom sheet between
   * three snap detents — peek / default / full. Ignored on the desktop docked
   * variant (there's nothing to expand into). Dragging below the lowest detent
   * closes the sheet. The handle is the only drag surface, so the body keeps its
   * own scroll/gesture behaviour untouched.
   */
  expandable?: boolean
  className?: string
}

// pb safe-area keeps the bottom-sheet content (e.g. chat input) above the iOS
// home indicator; it resolves to 0 on the desktop docked variant.
const sideClass: Record<NonNullable<SheetProps['side']>, string> = {
  right: 'right-3 top-3 bottom-3 w-[min(92vw,22rem)] rounded-island xl:w-[26rem]',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-island pb-[env(safe-area-inset-bottom)]',
  responsive:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-island pb-[env(safe-area-inset-bottom)] ' +
    // Docked chat/people panel. Narrower on small laptops (it ate ~40% of an md
    // viewport at 22rem) and steps up only on large screens.
    'md:inset-x-auto md:right-3 md:top-3 md:bottom-3 md:w-[min(92vw,19rem)] md:max-h-none md:rounded-island md:pb-0 lg:w-[21rem] xl:w-[24rem]',
}

// Snap detents as a fraction of viewport height (dvh). The sheet's height is
// driven directly so it can grow past the CSS max-height when dragged up.
const SNAP_PEEK = 0.45
const SNAP_DEFAULT = 0.7
const SNAP_FULL = 0.94
const CLOSE_BELOW = 0.3 // drag below this and release → close

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
  modal = true,
  expandable = false,
  className,
}: SheetProps) {
  // Drag state lives here so it resets each open. `frac` is the live height as a
  // fraction of the viewport; null means "use the CSS default" (desktop / not yet
  // dragged). Only meaningful for the mobile bottom layout.
  const [frac, setFrac] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startFrac: number } | null>(null)

  // Reset to the default detent whenever the sheet (re)opens.
  useEffect(() => {
    if (open) setFrac(expandable ? SNAP_DEFAULT : null)
  }, [open, expandable])

  const nearestSnap = (f: number): number => {
    const snaps = [SNAP_PEEK, SNAP_DEFAULT, SNAP_FULL]
    return snaps.reduce((best, s) => (Math.abs(s - f) < Math.abs(best - f) ? s : best), snaps[0])
  }

  const onHandleDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!expandable) return
      drag.current = { startY: e.clientY, startFrac: frac ?? SNAP_DEFAULT }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [expandable, frac],
  )

  const onHandleMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    // Dragging UP (negative dy) increases height. Convert pixel delta → fraction.
    const dy = e.clientY - drag.current.startY
    const next = drag.current.startFrac - dy / window.innerHeight
    setFrac(Math.min(SNAP_FULL, Math.max(0.05, next)))
  }, [])

  const onHandleUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return
      drag.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      setFrac((f) => {
        if (f != null && f < CLOSE_BELOW) {
          onOpenChange(false)
          return SNAP_DEFAULT
        }
        return nearestSnap(f ?? SNAP_DEFAULT)
      })
    },
    [onOpenChange],
  )

  // Height is only forced for the mobile bottom layout; on desktop the responsive
  // class anchors top+bottom, so the inline height is neutralised at `md` via
  // `md:!h-auto md:!max-h-none`.
  const draggableStyle =
    expandable && frac != null ? { height: `${Math.round(frac * 100)}dvh`, maxHeight: 'none' } : undefined

  return (
    <RD.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RD.Portal>
        {/* The scrim/inert layer only belongs to a modal sheet. A docked,
            non-modal panel must not cover (and pointer-block) the call behind it. */}
        {modal && <RD.Overlay className="fixed inset-0 z-40 bg-scrim mn-pop md:bg-transparent" />}
        <RD.Content
          // Non-modal: keep the panel open when the user clicks the stage or the
          // control bar (mute / leave / etc.) — only Esc or the close button shuts it.
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
          style={draggableStyle}
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-ink shadow-raised focus:outline-none',
            sideClass[side],
            // When a drag height is applied, neutralise it at the desktop breakpoint.
            draggableStyle && 'md:!h-auto md:!max-h-none',
            // While dragging, drop the height transition for 1:1 finger tracking.
            !drag.current && expandable && 'transition-[height] duration-200 ease-out',
            className,
          )}
        >
          {/* Drag handle — mobile only, and only when expandable. It's the sole
              drag surface so the message list keeps its own scroll. */}
          {expandable && (
            <div
              className="flex shrink-0 cursor-grab touch-none justify-center pt-2 pb-1 active:cursor-grabbing md:hidden"
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              role="separator"
              aria-label="Drag to resize panel"
              aria-orientation="horizontal"
            >
              <span aria-hidden className="h-1 w-9 rounded-full bg-line-strong" />
            </div>
          )}
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
