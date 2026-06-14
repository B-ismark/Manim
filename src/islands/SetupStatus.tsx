import { useState } from 'react'
import { Island, Popover } from '@/components/primitives'
import { CheckIcon } from '@/components/icons'
import { useConfigStatus, type ConfigItem } from '@/features/config/useConfigStatus'
import { cn } from '@/lib/cn'

/**
 * Single visible "what's configured" surface. Lists every integration with a
 * green/grey dot and, for anything off, the env var that turns it on. Optional
 * features degrade silently elsewhere — this is the one place that says why.
 */
function StatusList() {
  const { items, ready } = useConfigStatus()
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it) => (
        <StatusRow key={it.key} item={it} ready={ready} />
      ))}
    </ul>
  )
}

function StatusRow({ item, ready }: { item: ConfigItem; ready: boolean }) {
  // Don't show a server-dependent item as "off" until the probe has resolved.
  const pending = !ready && (item.key === 'livekit' || item.key === 'email')
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full [&_svg]:size-2.5',
          pending ? 'bg-sunken' : item.ok ? 'bg-success text-accent-ink' : 'bg-sunken',
        )}
        aria-hidden
      >
        {item.ok && !pending && <CheckIcon />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">
          {item.label}
          {item.required && <span className="ml-1 text-xs text-ink-subtle">(required)</span>}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {pending ? 'Checking…' : item.ok ? 'Configured' : item.hint}
        </p>
      </div>
    </li>
  )
}

/** Trigger + popover for the header (Landing). Shows a dot when something's off. */
export function SetupStatusButton() {
  const { items, ready, blocked } = useConfigStatus()
  const anyOff = ready && items.some((i) => !i.ok)
  return (
    <Popover
      side="bottom"
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Setup status"
          className="relative inline-flex h-9 items-center gap-1.5 rounded-control bg-sunken px-3 text-sm text-ink-muted hover:text-ink"
        >
          Setup
          {anyOff && (
            <span
              className={cn(
                'size-2 rounded-full',
                blocked ? 'bg-danger' : 'bg-warning',
              )}
              aria-hidden
            />
          )}
        </button>
      }
    >
      <div className="w-72 p-2">
        <p className="mb-2 px-1 text-xs font-medium text-ink-subtle">Setup status</p>
        <StatusList />
      </div>
    </Popover>
  )
}

/**
 * Dismissible banner shown when a REQUIRED capability is missing (calls won't
 * work). Optional gaps stay quiet in the Setup popover. Returns null when fine.
 */
export function SetupBanner() {
  const { blocked, ready } = useConfigStatus()
  const [dismissed, setDismissed] = useState(false)
  if (!ready || !blocked || dismissed) return null
  return (
    <Island elevation="pop" pad="sm" bordered className="w-full max-w-md border-danger/40">
      <div className="flex items-start gap-3">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Video calls aren’t configured</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Set VITE_LIVEKIT_URL plus the LIVEKIT_API_KEY / LIVEKIT_API_SECRET runtime
            Secrets on the Worker, then redeploy. See the Setup menu for details.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-field px-2 py-1 text-xs text-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </Island>
  )
}
