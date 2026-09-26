import { useEffect, useState } from 'react'
import { useToastStore, type Toast, type ToastTone } from '@/store/useToastStore'
import { cn } from '@/lib/cn'
import { CloseIcon } from '@/components/icons'

/** Warnings and errors outlive chit-chat: they're what someone must act on. */
const baseLife: Record<ToastTone, number> = { neutral: 4000, info: 4000, warning: 7000, danger: 8000 }

/**
 * How long a toast stays up. The text length matters as much as the tone — a
 * fixed 4s dismissed "Encryption couldn't be turned on — this call is NOT
 * end-to-end encrypted" before most people had read it, and touch users can't
 * hover to pause. ~60ms a character is an unhurried reading pace.
 */
export function toastLife(t: Pick<Toast, 'duration' | 'tone' | 'text'>): number {
  return t.duration ?? Math.max(baseLife[t.tone], t.text.length * 60)
}

const dotTone: Record<ToastTone, string> = {
  neutral: 'bg-ink-subtle',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Pause the auto-dismiss while the user is reading or reaching for the action
  // button (hover or keyboard focus) — the timer otherwise expires mid-reach.
  // Resuming restarts the window, which is the Gmail-style tradeoff: slightly
  // longer total life in exchange for never losing an actionable toast.
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const id = window.setTimeout(onDismiss, toastLife(toast))
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])
  return (
    <div
      // No role of its own: the stack below is the one live region. A nested
      // alert inside it is read twice by NVDA and JAWS in Chrome.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Capped so a centred toast clears a tile's corner controls on touch (x 16..60,
      // see CLAUDE.md "A full-width TopStack child…"); it used to reach them.
      className="mn-pop pointer-events-auto flex max-w-[calc(100%-6rem)] items-center gap-2.5 rounded-control bg-raised px-3.5 py-2 text-sm text-ink shadow-pop border border-line sm:max-w-md"
    >
      <span className={cn('size-2 shrink-0 rounded-full', dotTone[toast.tone])} aria-hidden />
      {/* Wrap, never truncate or clamp: the clipped tail was usually the part that
          mattered ("…isn’t end-to-end encrypted"). */}
      <span className="min-w-0" dir="auto">
        {toast.text}
      </span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick()
            onDismiss()
          }}
          className="-mr-1 shrink-0 rounded-control px-2 py-0.5 text-sm font-medium text-accent hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {toast.action.label}
        </button>
      )}
      {/* Touch has no hover-to-pause, so the ones worth reading get a way out
          that isn't "wait". */}
      {!toast.action && (toast.tone === 'warning' || toast.tone === 'danger') && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2.5 -mr-3 grid size-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-4"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

/** Global notification stack (join/leave, reports). Mounted once in App. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  // Always mounted, even when empty: a live region inserted already holding its
  // text is often not announced at all, so the region has to exist first.
  return (
    <div
      aria-live="polite"
      data-testid="toasts"
      // Starts below whatever owns the top band (TopStack's banners, prejoin's Back
      // row on a phone) — lib/toastClearance measures it.
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top),var(--toast-top,0px))] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}
