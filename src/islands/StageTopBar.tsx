import { useParticipants } from '@livekit/components-react'
import { StageChip } from '@/components/primitives'
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

  return (
    <div
      className={cn(
        'fixed right-4 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-20 flex items-center gap-2',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && 'pointer-events-none -translate-y-[150%] opacity-0',
      )}
    >
      {isFullscreen && (
        <StageChip onClick={exitFullscreen} aria-label="Exit full screen">
          <ExitFullscreenIcon />
        </StageChip>
      )}
      {showParticipants && (
        <StageChip onClick={() => setPanel('people')} aria-label={`Participants (${participants.length})`}>
          <PeopleIcon />
          {participants.length}
        </StageChip>
      )}
    </div>
  )
}
