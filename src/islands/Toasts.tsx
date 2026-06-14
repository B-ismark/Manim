import { useEffect } from 'react'
import { useToastStore, type Toast, type ToastTone } from '@/store/useToastStore'
import { cn } from '@/lib/cn'

const dotTone: Record<ToastTone, string> = {
  neutral: 'bg-ink-subtle',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 4000)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      role="status"
      className="mn-pop pointer-events-auto flex items-center gap-2.5 rounded-control bg-raised px-3.5 py-2 text-sm text-ink shadow-pop border border-line"
    >
      <span className={cn('size-2 shrink-0 rounded-full', dotTone[toast.tone])} aria-hidden />
      <span className="max-w-[18rem] truncate">{toast.text}</span>
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
