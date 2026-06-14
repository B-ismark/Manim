import { lazy, Suspense, useEffect } from 'react'
import { RoomAudioRenderer, useRoomContext } from '@livekit/components-react'
import { Stage } from '@/islands/Stage'
import { ControlBar } from '@/islands/ControlBar'
import { ReactionsOverlay } from '@/islands/ReactionsOverlay'
import { HandoffBanner } from '@/islands/HandoffBanner'
import { WaitingRoomBanner } from '@/islands/WaitingRoomBanner'
import { ConnectionBanner } from '@/islands/ConnectionBanner'
import { useReactions } from '@/features/reactions/useReactions'
import { useBackgroundBlur } from '@/features/effects/useBackgroundBlur'
import { useSessionControl } from '@/features/session/useSessionControl'
import { useRoomStore } from '@/store/useRoomStore'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/cn'

// The chat/participants panel is only needed once opened — defer its chunk.
const SidePanel = lazy(() => import('@/islands/SidePanel').then((m) => ({ default: m.SidePanel })))

/**
 * Everything inside the LiveKitRoom provider. Owns shared hooks (reactions,
 * blur, session control) and reflows the stage when the side panel docks on
 * desktop (STYLE.md §4).
 */
export function RoomView({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext()
  const e2eePassphrase = useAppStore((s) => s.prejoin.e2ee)
  const { active, sendReaction, handRaised, toggleHand } = useReactions()
  const blur = useBackgroundBlur()

  // Activate end-to-end encryption when a passphrase was set at prejoin. The key
  // is already configured on the room's keyProvider (see roomOptions).
  useEffect(() => {
    if (e2eePassphrase) void room.setE2EEEnabled(true).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const {
    isHost,
    locked,
    waiting,
    doLeave,
    endForEveryone,
    mergeInto,
    toggleLock,
    toggleWaiting,
    sameNameOther,
    switchToThisDevice,
  } = useSessionControl(onLeave)
  const panel = useRoomStore((s) => s.panel)

  return (
    <>
      <RoomAudioRenderer />
      <ConnectionBanner />

      {sameNameOther && <HandoffBanner onSwitch={switchToThisDevice} />}
      <WaitingRoomBanner active={isHost && waiting} />

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
        onMerge={mergeInto}
        isHost={isHost}
        locked={locked}
        onToggleLock={toggleLock}
        waiting={waiting}
        onToggleWaiting={toggleWaiting}
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
