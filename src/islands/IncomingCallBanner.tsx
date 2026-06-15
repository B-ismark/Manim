import { useNavigate } from 'react-router-dom'
import { Island, Button, Avatar } from '@/components/primitives'
import { useIncomingCalls } from '@/features/calls/calls'
import { useAppStore } from '@/store/useAppStore'

/**
 * App-level incoming-call surface, mounted once. Owns the single Realtime
 * subscription (useIncomingCalls). Shown only when NOT in a call — once you're in
 * a room the in-call banner (InCallIncomingBanner) takes over, since that's where
 * merging the two calls is possible.
 */
export function IncomingCallBanner() {
  const { incoming, dismiss } = useIncomingCalls()
  const inCall = useAppStore((s) => s.roomToken !== null)
  const navigate = useNavigate()
  // In a call → defer to the in-call banner (which adds Merge / Switch).
  if (inCall || !incoming) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
        <Avatar name={incoming.fromName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{incoming.fromName} is calling</p>
          <p className="text-xs text-ink-muted">Room {incoming.room}</p>
        </div>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            const room = incoming.room
            dismiss()
            navigate(`/r/${encodeURIComponent(room)}`)
          }}
        >
          Join
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Ignore
        </Button>
      </Island>
    </div>
  )
}
