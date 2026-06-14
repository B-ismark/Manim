import { useNavigate } from 'react-router-dom'
import { Island, Button, Avatar } from '@/components/primitives'
import { useIncomingCalls } from '@/features/calls/calls'

/**
 * App-level incoming-call surface. Mounted once (CallController). Joining
 * navigates into the caller's room — if you're already in a call, the host can
 * then merge the two rooms (More → Merge).
 */
export function IncomingCallBanner() {
  const { incoming, dismiss } = useIncomingCalls()
  const navigate = useNavigate()
  if (!incoming) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
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
