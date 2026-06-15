import { useConnectionState } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { Island } from '@/components/primitives'

/**
 * Surfaces network trouble: a banner while LiveKit is re-establishing the
 * connection after a drop. LiveKit auto-reconnects; this just keeps the user
 * informed instead of leaving a frozen call.
 */
export function ConnectionBanner() {
  const state = useConnectionState()
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting

  if (!reconnecting) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-40 flex justify-center px-4">
      <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-2.5">
        <span className="size-2 animate-pulse rounded-full bg-warning" aria-hidden />
        <p className="text-sm text-ink">Reconnecting…</p>
      </Island>
    </div>
  )
}
