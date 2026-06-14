import { lazy, Suspense, useCallback, useMemo } from 'react'
import {
  RoomAudioRenderer,
  useDataChannel,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react'
import { Stage } from '@/islands/Stage'
import { ControlBar } from '@/islands/ControlBar'
import { ReactionsOverlay } from '@/islands/ReactionsOverlay'
import { useReactions } from '@/features/reactions/useReactions'
import { useBackgroundBlur } from '@/features/effects/useBackgroundBlur'
import { useRoomStore } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

// The chat/participants panel is only needed once opened — defer its chunk.
const SidePanel = lazy(() => import('@/islands/SidePanel').then((m) => ({ default: m.SidePanel })))

/** Room control signalling (host ending the call for everyone). */
const CONTROL_TOPIC = 'mn.control'

/**
 * Everything inside the LiveKitRoom provider. Owns shared hooks (reactions,
 * blur) and the host control channel, and reflows the stage when the side panel
 * docks on desktop (STYLE.md §4).
 */
export function RoomView({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const { active, sendReaction, handRaised, toggleHand } = useReactions()
  const blur = useBackgroundBlur()
  const panel = useRoomStore((s) => s.panel)

  // Host flag is stamped into the token metadata server-side (first joiner).
  const isHost = useMemo(() => {
    try {
      return Boolean(JSON.parse(localParticipant.metadata || '{}').host)
    } catch {
      return false
    }
  }, [localParticipant.metadata])

  const doLeave = useCallback(async () => {
    try {
      await room.disconnect()
    } catch {
      /* already disconnected */
    }
    onLeave()
  }, [room, onLeave])

  // Listen for the host's "end call" broadcast → everyone leaves.
  const { send } = useDataChannel(CONTROL_TOPIC, (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as { type?: string }
      if (data.type === 'end') void doLeave()
    } catch {
      /* malformed control message — ignore */
    }
  })

  const endForEveryone = useCallback(async () => {
    try {
      await send(new TextEncoder().encode(JSON.stringify({ type: 'end' })), {
        reliable: true,
        topic: CONTROL_TOPIC,
      })
    } catch {
      /* best effort */
    }
    await doLeave()
  }, [send, doLeave])

  return (
    <>
      <RoomAudioRenderer />
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-[padding] duration-[var(--dur-base)] ease-[var(--ease-island)]',
          panel && 'md:pr-[23rem]',
        )}
      >
        <Stage />
      </div>

      <ControlBar
        onLeave={doLeave}
        onEndForEveryone={endForEveryone}
        isHost={isHost}
        sendReaction={sendReaction}
        handRaised={handRaised}
        toggleHand={toggleHand}
        blur={blur}
      />
      <ReactionsOverlay reactions={active} />

      {panel !== null && (
        <Suspense fallback={null}>
          <SidePanel />
        </Suspense>
      )}
    </>
  )
}
