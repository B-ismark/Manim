import { lazy, Suspense, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { RoomAudioRenderer, useRoomContext, useConnectionState } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { Stage } from '@/islands/Stage'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { PipPanel } from '@/islands/PipPanel'
import { ControlBar } from '@/islands/ControlBar'
import { ReactionsOverlay } from '@/islands/ReactionsOverlay'
import { HandoffBanner } from '@/islands/HandoffBanner'
import { WaitingRoomBanner } from '@/islands/WaitingRoomBanner'
import { ConnectionBanner } from '@/islands/ConnectionBanner'
import { InCallIncomingBanner } from '@/islands/InCallIncomingBanner'
import { useReactions } from '@/features/reactions/useReactions'
import { useBackgroundBlur } from '@/features/effects/useBackgroundBlur'
import { useNoiseFilter } from '@/features/effects/useNoiseFilter'
import { useCallSounds } from '@/features/sounds/useCallSounds'
import { useDocumentPip } from '@/features/pip/useDocumentPip'
import { useApplyBlocks } from '@/features/moderation/useApplyBlocks'
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
  const noise = useNoiseFilter()
  const docPip = useDocumentPip()
  useCallSounds()
  useApplyBlocks()

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
  const connState = useConnectionState()

  // Cover the initial connect (before media + roster arrive) with the joining
  // screen. Reconnects after that are handled by ConnectionBanner, not here.
  if (connState === ConnectionState.Connecting) {
    return <JoiningScreen room={room.name} label="Connecting" />
  }

  return (
    <>
      <RoomAudioRenderer />
      <ConnectionBanner />

      {sameNameOther && <HandoffBanner onSwitch={switchToThisDevice} />}
      <WaitingRoomBanner active={isHost && waiting} />
      <InCallIncomingBanner isHost={isHost} onMerge={mergeInto} />

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
        locked={locked}
        onToggleLock={toggleLock}
        waiting={waiting}
        onToggleWaiting={toggleWaiting}
        sendReaction={sendReaction}
        handRaised={handRaised}
        toggleHand={toggleHand}
        blur={blur}
        noise={noise}
        docPip={{ supported: docPip.supported, active: docPip.active, toggle: docPip.toggle }}
      />
      <ReactionsOverlay reactions={active} />

      {panel !== null && (
        <Suspense fallback={null}>
          <SidePanel />
        </Suspense>
      )}

      {/* Document PiP: the panel lives in its own OS window but stays in the
          React/LiveKit tree via a portal, so its controls drive this session. */}
      {docPip.pipWindow && createPortal(<PipPanel onLeave={doLeave} />, docPip.pipWindow.document.body)}
    </>
  )
}
