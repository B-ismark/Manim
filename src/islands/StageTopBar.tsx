import { useParticipants } from '@livekit/components-react'
import { ExitFullscreenIcon, PeopleIcon } from '@/components/icons'
import { useRoomStore } from '@/store/useRoomStore'
import { useFullscreen } from '@/lib/useFullscreen'
import { cn } from '@/lib/cn'

/**
 * Top-right action cluster (WhatsApp / Meet convention). Holds the participants
 * count (opens the roster) and — only while in fullscreen — a quick exit button,
 * so leaving fullscreen never requires the More menu. Hides with the chrome on
 * touch. Participants steps aside when a side panel is already open; the exit
 * button stays so fullscreen is always escapable. Works on both pointer types.
 */
export function StageTopBar({ visible }: { visible: boolean }) {
  const participants = useParticipants()
  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const { isFullscreen, exitFullscreen } = useFullscreen()

  const showParticipants = panel === null
  if (!showParticipants && !isFullscreen) return null

  const pill = 'flex items-center gap-1.5 rounded-control bg-overlay px-2.5 py-1.5 text-sm font-medium text-white shadow-raised backdrop-blur [&_svg]:size-4'

  return (
    <div
      className={cn(
        'fixed right-4 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-20 flex items-center gap-2',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && '-translate-y-[150%] opacity-0',
      )}
    >
      {isFullscreen && (
        <button type="button" onClick={exitFullscreen} aria-label="Exit full screen" className={pill}>
          <ExitFullscreenIcon />
        </button>
      )}
      {showParticipants && (
        <button
          type="button"
          onClick={() => setPanel('people')}
          aria-label={`Participants (${participants.length})`}
          className={pill}
        >
          <PeopleIcon />
          {participants.length}
        </button>
      )}
    </div>
  )
}
