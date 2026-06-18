import { useNavigate } from 'react-router-dom'
import { Island, Button, Avatar } from '@/components/primitives'
import { LeaveIcon, CameraIcon } from '@/components/icons'
import { useIncomingCalls } from '@/features/calls/calls'
import { useAppStore } from '@/store/useAppStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { roomTo } from '@/lib/roomLink'

/**
 * App-level incoming-call surface, mounted once. Owns the single Realtime
 * subscription (useIncomingCalls). Shown only when NOT in a call — once you're in
 * a room the in-call banner (InCallIncomingBanner) takes over, since that's where
 * merging the two calls is possible.
 *
 * On touch it's a full-screen ringing overlay (phone-call convention: big
 * Accept / Decline); on desktop a compact top banner.
 */
export function IncomingCallBanner() {
  const { incoming, dismiss } = useIncomingCalls()
  const inCall = useAppStore((s) => s.roomToken !== null)
  const touch = useIsTouch()
  const navigate = useNavigate()
  // In a call → defer to the in-call banner (which adds Merge / Switch).
  if (inCall || !incoming) return null

  const accept = () => {
    const { room, secret, e2ee } = incoming
    dismiss()
    // autojoin: you already consented by tapping Accept — skip the second prejoin
    // and connect straight in (RoomRoute auto-joins on this nav state). Carry the
    // ring's secrets so the join-secret gate passes and E2EE keys up.
    navigate(roomTo(room, { secret, e2ee }), { state: { autojoin: true } })
  }

  if (touch) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-stage px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))]">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Avatar name={incoming.fromName} size="xl" />
          <div>
            <p className="text-xl font-semibold">{incoming.fromName}</p>
            <p className="mt-1 text-sm text-ink-muted">is calling · Room {incoming.room}</p>
          </div>
        </div>
        <div className="flex w-full max-w-sm items-center justify-around">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              aria-label="Decline call"
              className="grid size-16 place-items-center rounded-full bg-danger text-danger-ink shadow-raised transition-colors hover:bg-danger-hover [&_svg]:size-7"
            >
              <LeaveIcon />
            </button>
            <span className="text-xs text-ink-muted">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={accept}
              aria-label="Accept call"
              className="grid size-16 place-items-center rounded-full bg-success text-white shadow-raised transition-opacity hover:opacity-90 [&_svg]:size-7"
            >
              <CameraIcon />
            </button>
            <span className="text-xs text-ink-muted">Accept</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <Island elevation="raised" pad="sm" className="pointer-events-auto flex items-center gap-3">
        <Avatar name={incoming.fromName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{incoming.fromName} is calling</p>
          <p className="text-xs text-ink-muted">Room {incoming.room}</p>
        </div>
        <Button size="sm" variant="accent" onClick={accept}>
          Join
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Ignore
        </Button>
      </Island>
    </div>
  )
}
