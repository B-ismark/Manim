import { useNavigate } from 'react-router-dom'
import { Island, Button, Avatar } from '@/components/primitives'
import { MergeIcon } from '@/components/icons'
import { useCallStore } from '@/store/useCallStore'
import { roomTo, type RoomSecrets } from '@/lib/roomLink'

/**
 * Incoming call while you're ALREADY in a call. This is the only place merge is
 * offered — it's a contextual response to a second call, not a standing menu
 * item. Options:
 *  - Merge (host only): pull this call's participants into the caller's room.
 *  - Switch: leave this call and join the caller's room instead.
 *  - Ignore.
 *
 * Reads the shared call store (the single subscription lives in the app-level
 * IncomingCallBanner, which hides itself while in a call).
 */
export function InCallIncomingBanner({
  isHost,
  onMerge,
}: {
  isHost: boolean
  onMerge: (room: string, secrets: RoomSecrets) => void
}) {
  const incoming = useCallStore((s) => s.incoming)
  const dismiss = useCallStore((s) => s.dismiss)
  const navigate = useNavigate()
  if (!incoming) return null

  const room = incoming.room
  const secrets: RoomSecrets = { secret: incoming.secret, e2ee: incoming.e2ee }

  return (
    <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
      <Avatar name={incoming.fromName} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{incoming.fromName} is calling</p>
        <p className="text-xs text-ink-muted">Room {room}</p>
      </div>
      {isHost && (
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            dismiss()
            onMerge(room, secrets)
          }}
        >
          <MergeIcon />
          Merge calls
        </Button>
      )}
      <Button
        size="sm"
        variant="neutral"
        onClick={() => {
          dismiss()
          navigate(roomTo(room, secrets), { state: { autojoin: true } })
        }}
      >
        Switch
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Ignore
      </Button>
    </Island>
  )
}
