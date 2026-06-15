import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
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
import { CallStatusBar } from '@/islands/CallStatusBar'
import { PinCoachmark } from '@/islands/PinCoachmark'
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
import { isTouch } from '@/lib/device'
import { cn } from '@/lib/cn'

/**
 * Mobile gesture + auto-hide-chrome controller for the stage.
 * - Tap empty stage → toggle the control bar (FaceTime/Zoom/Telegram pattern).
 * - Horizontal swipe → switch grid ↔ speaker layout.
 * - Controls auto-hide after 4s on touch devices; any tap brings them back.
 * Desktop keeps controls always visible (hover model) and ignores gestures.
 */
function useStageChrome() {
  // Touch-UX (auto-hide / gestures) keys off pointer type, matching the compact
  // bar and portrait tiles — so wide foldables behave consistently.
  const mobile = useMemo(() => isTouch(), [])
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const [visible, setVisible] = useState(true)
  const hideTimer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  const down = useRef<{ x: number; y: number; t: number } | null>(null)

  const scheduleHide = useCallback(() => {
    // Don't auto-hide while a menu is open (held) — the control bar must stay
    // put or the open popover loses its anchor.
    if (!mobile || held.current) return
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setVisible(false), 4000)
  }, [mobile])

  const show = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide])

  // Pin the chrome open (e.g. while the More menu is showing); release resumes
  // the auto-hide countdown.
  const setHold = useCallback(
    (hold: boolean) => {
      held.current = hold
      if (hold) {
        window.clearTimeout(hideTimer.current)
        setVisible(true)
      } else {
        scheduleHide()
      }
    },
    [scheduleHide],
  )

  useEffect(() => {
    if (mobile) scheduleHide()
    return () => window.clearTimeout(hideTimer.current)
  }, [mobile, scheduleHide])

  const onPointerDown = useCallback((e: PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
  }, [])

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const d = down.current
      down.current = null
      if (!d || !mobile) return
      // Ignore interactions on real controls (buttons) or the draggable self-view.
      if ((e.target as HTMLElement).closest('button, a, input, [data-no-stage-gesture]')) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      const dt = e.timeStamp - d.t
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        setLayout(layout === 'grid' ? 'speaker' : 'grid') // horizontal swipe
      } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 300) {
        setVisible((v) => !v) // tap toggles chrome
        scheduleHide()
      }
    },
    [mobile, layout, setLayout, scheduleHide],
  )

  return { chromeVisible: visible, show, setChromeHold: setHold, stageHandlers: { onPointerDown, onPointerUp } }
}

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
  const { chromeVisible, setChromeHold, stageHandlers } = useStageChrome()

  // Cover the initial connect (before media + roster arrive) with the joining
  // screen. Reconnects after that are handled by ConnectionBanner, not here.
  if (connState === ConnectionState.Connecting) {
    return <JoiningScreen room={room.name} label="Connecting" />
  }

  return (
    <>
      <RoomAudioRenderer />
      <ConnectionBanner />
      <CallStatusBar encrypted={Boolean(e2eePassphrase)} visible={chromeVisible} />
      <PinCoachmark />

      {sameNameOther && <HandoffBanner onSwitch={switchToThisDevice} />}
      <WaitingRoomBanner active={isHost && waiting} />
      <InCallIncomingBanner isHost={isHost} onMerge={mergeInto} />

      <div
        {...stageHandlers}
        className={cn(
          'mn-pop flex min-h-0 flex-1 flex-col transition-[padding] duration-[var(--dur-base)] ease-[var(--ease-island)]',
          panel && 'md:pr-[23rem]',
        )}
      >
        <Stage />
      </div>

      <ControlBar
        chromeVisible={chromeVisible}
        onMenuOpenChange={setChromeHold}
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
