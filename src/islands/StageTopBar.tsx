import { useParticipants } from '@livekit/components-react'
import { PeopleIcon } from '@/components/icons'
import { useRoomStore } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

/**
 * Top-right roster affordance (WhatsApp / Meet convention) — participants live
 * here, not in the bottom control island. Hides with the chrome on touch, and
 * steps aside when a side panel is already open (it docks/covers the right edge
 * on desktop, fills the screen on mobile). Works on both pointer types.
 */
export function StageTopBar({ visible }: { visible: boolean }) {
  const participants = useParticipants()
  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  if (panel !== null) return null

  return (
    <div
      className={cn(
        'fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-20',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && '-translate-y-[150%] opacity-0',
      )}
    >
      <button
        type="button"
        onClick={() => setPanel('people')}
        aria-label={`Participants (${participants.length})`}
        className="flex items-center gap-1.5 rounded-control bg-overlay px-2.5 py-1.5 text-sm font-medium text-white shadow-raised backdrop-blur [&_svg]:size-4"
      >
        <PeopleIcon />
        {participants.length}
      </button>
    </div>
  )
}
