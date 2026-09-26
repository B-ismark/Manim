import { useEffect } from 'react'
import { useConnectionState } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { Button, Island } from '@/components/primitives'
import { clearTrouble, formatElapsed, noteTrouble, troubleSince, useElapsed, useOnline } from '@/lib/connectionTrouble'

/** After this long, say what to check instead of just "Reconnecting…". */
const HINT_AFTER_MS = 10_000

/**
 * Network trouble, said honestly: "Reconnecting… 0:12", ticking, with a way
 * out. LiveKit keeps retrying on its own; a frozen picture with no clock and no
 * exit left people unsure whether to wait or give up. After a few seconds it
 * says what to check, and it says "You're offline" when the browser knows.
 *
 * If LiveKit gives up altogether, RoomRoute's Reconnecting screen takes over
 * and keeps trying, on the same clock (lib/connectionTrouble).
 */
export function ConnectionBanner({ onLeave }: { onLeave: () => void }) {
  const state = useConnectionState()
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting
  useEffect(() => {
    if (reconnecting) noteTrouble()
    else if (state === ConnectionState.Connected) clearTrouble()
  }, [reconnecting, state])
  const elapsed = useElapsed(reconnecting ? troubleSince() || Date.now() : 0)
  const online = useOnline()

  if (!reconnecting) return null
  const hint = !online ? 'You’re offline. Check Wi-Fi or mobile data.' : elapsed >= HINT_AFTER_MS ? 'Check your Wi-Fi or mobile data.' : null

  // Positioned by TopStack — see the layer scale there.
  return (
    <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3 pl-3.5">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden />
      {/* Not a live region: a clock ticking in one would be read out every
          second. CallAnnouncer already says "Connection lost. Reconnecting…". */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          Reconnecting… <span className="tabular-nums">{formatElapsed(elapsed)}</span>
        </p>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      <Button size="md" className="ml-1 h-11 shrink-0" onClick={onLeave}>
        Leave
      </Button>
    </Island>
  )
}
