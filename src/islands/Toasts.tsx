import { useEffect, useState } from 'react'
import { useToastStore, type Toast, type ToastTone } from '@/store/useToastStore'
import { cn } from '@/lib/cn'

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
    const id = window.setTimeout(onDismiss, toast.duration ?? 4000)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])
  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="mn-pop pointer-events-auto flex items-center gap-2.5 rounded-control bg-raised px-3.5 py-2 text-sm text-ink shadow-pop border border-line"
    >
      <span className={cn('size-2 shrink-0 rounded-full', dotTone[toast.tone])} aria-hidden />
      {/* Don't truncate an actionable toast — its text + button must stay readable. */}
      <span className={cn(toast.action ? 'max-w-[18rem]' : 'max-w-[18rem] truncate')}>{toast.text}</span>
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
    </div>
  )
}

/** Global notification stack (join/leave, reports). Mounted once in App. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}
