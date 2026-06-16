import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { RoomAudioRenderer, useRoomContext, useConnectionState, useParticipants } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { Stage } from '@/islands/Stage'
import { JoiningScreen } from '@/islands/JoiningScreen'
import { PipPanel } from '@/islands/PipPanel'
import { ControlBar } from '@/islands/ControlBar'
import { ReactionsOverlay } from '@/islands/ReactionsOverlay'
import { HandoffBanner } from '@/islands/HandoffBanner'
import { WaitingRoomBanner } from '@/islands/WaitingRoomBanner'
import { ConnectionBanner } from '@/islands/ConnectionBanner'
import { CallStatusBar } from '@/islands/CallStatusBar'
import { CallAnnouncer } from '@/islands/CallAnnouncer'
import { LayoutChip } from '@/islands/LayoutChip'
import { StageTopBar } from '@/islands/StageTopBar'
import { EffectsCarousel } from '@/islands/EffectsCarousel'
import { PinCoachmark } from '@/islands/PinCoachmark'
import { InCallIncomingBanner } from '@/islands/InCallIncomingBanner'
import { useChatMessages } from '@/features/chat/useChatMessages'
import { usePublishMeetingPresence } from '@/features/calls/usePresence'
import { useReactions } from '@/features/reactions/useReactions'
import { useBackgroundBlur } from '@/features/effects/useBackgroundBlur'
import { useAdaptiveQuality } from '@/features/effects/useAdaptiveQuality'
import { useNoiseFilter } from '@/features/effects/useNoiseFilter'
import { useCallSounds } from '@/features/sounds/useCallSounds'
import { useDocumentPip } from '@/features/pip/useDocumentPip'
import { useAutoBackgroundPip } from '@/features/pip/useAutoBackgroundPip'
import { useMediaSessionControls } from '@/features/pip/useMediaSessionControls'
import { useApplyBlocks } from '@/features/moderation/useApplyBlocks'
import { useSessionControl } from '@/features/session/useSessionControl'
import { useRoomStore } from '@/store/useRoomStore'
import { useEffectsUi } from '@/store/useEffectsUi'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/primitives'
import { HandIcon, PipIcon } from '@/components/icons'
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

/** Minutes alone before the call auto-ends (a forgotten-open-call guard). */
const SOLO_TIMEOUT_MS = 10 * 60 * 1000
/**
 * Auto-leave when you've been the only one in the room for a long time — stops a
 * forgotten call running forever. A warning toast fires a minute before. The
 * timers reset the moment anyone else is present.
 */
function useSoloAutoLeave(onLeave: () => void) {
  const participants = useParticipants()
  const alone = participants.length <= 1
  useEffect(() => {
    if (!alone) return
    const warn = window.setTimeout(
      () => toast('You’re alone — the call will end soon', 'neutral'),
      SOLO_TIMEOUT_MS - 60_000,
    )
    const end = window.setTimeout(onLeave, SOLO_TIMEOUT_MS)
    return () => {
      window.clearTimeout(warn)
      window.clearTimeout(end)
    }
  }, [alone, onLeave])
}

/**
 * Everything inside the LiveKitRoom provider. Owns shared hooks (reactions,
 * blur, session control) and reflows the stage when the side panel docks on
 * desktop (STYLE.md §4).
 */
export function RoomView({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext()
  const e2eePassphrase = useAppStore((s) => s.prejoin.e2ee)
  const { active, sendReaction, handRaised, toggleHand } = useReactions()
  // Chat state is owned here (persists across the side panel opening/closing —
  // LiveKit chat history is transient and would otherwise reset on remount).
  const chat = useChatMessages()
  const lowBandwidth = useAppStore((s) => s.prejoin.lowBandwidth)
  const blur = useBackgroundBlur()
  const noise = useNoiseFilter()
  // Network-driven LOD: drop capture only when the live uplink is struggling.
  useAdaptiveQuality(lowBandwidth)
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
  const carouselOpen = useEffectsUi((s) => s.carouselOpen)
  const connState = useConnectionState()
  // Mobile: float the call into OS PiP when the app is backgrounded, restore on return.
  useAutoBackgroundPip(connState === ConnectionState.Connected)
  const { chromeVisible, setChromeHold, stageHandlers } = useStageChrome()
  // Mic/camera/hang-up buttons in native PiP + OS media controls.
  useMediaSessionControls(doLeave)
  // End a forgotten call left running alone.
  useSoloAutoLeave(doLeave)
  // Advertise this call to the user's other signed-in devices (quick-join).
  usePublishMeetingPresence(room.name)

  // Cover the initial connect with the joining screen (same label as RoomRoute's
  // so the knock→connect handoff doesn't jump). Reconnects after that are handled
  // by ConnectionBanner, not here.
  if (connState === ConnectionState.Connecting) {
    return <JoiningScreen room={room.name} />
  }

  return (
    <>
      <RoomAudioRenderer />
      <CallAnnouncer />
      {/* Faint top scrim: visually groups the floating top chrome (layout chip /
          timer / participants) and guarantees their contrast over bright video.
          Hides with the chrome. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/30 to-transparent transition-opacity duration-[var(--dur-base)]',
          !chromeVisible && 'opacity-0',
        )}
      />
      <ConnectionBanner />
      <CallStatusBar encrypted={Boolean(e2eePassphrase)} visible={chromeVisible} />
      <LayoutChip visible={chromeVisible} onMenuOpenChange={setChromeHold} />
      <StageTopBar visible={chromeVisible} />
      <PinCoachmark />
      <RaisedHandPill raised={handRaised} onLower={toggleHand} visible={chromeVisible} />

      {sameNameOther && <HandoffBanner onSwitch={switchToThisDevice} />}
      <WaitingRoomBanner active={isHost && waiting} />
      <InCallIncomingBanner isHost={isHost} onMerge={mergeInto} />

      <div
        {...stageHandlers}
        className={cn(
          // Fade only (no scale): scaling a container that holds live <video>
          // causes a repaint flash on connect. transition is for the panel reflow.
          'mn-fade flex min-h-0 flex-1 flex-col transition-[padding] duration-[var(--dur-base)] ease-[var(--ease-island)]',
          panel && 'md:pr-[23rem] xl:pr-[27rem]',
        )}
      >
        {/* While the call is in the floating PiP window, don't also render the
            stage here — it would decode every video twice. Show a placeholder
            with a way back. */}
        {docPip.active ? <PipPlaceholder onBack={docPip.toggle} /> : <Stage />}
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
      <EffectsCarousel controls={blur} visible={chromeVisible && carouselOpen} />
      <ReactionsOverlay reactions={active} />

      {panel !== null && (
        <Suspense fallback={null}>
          <SidePanel chat={chat} />
        </Suspense>
      )}

      {/* Document PiP: the panel lives in its own OS window but stays in the
          React/LiveKit tree via a portal, so its controls drive this session. */}
      {docPip.pipWindow &&
        createPortal(
          <PipPanel onLeave={doLeave} onClose={docPip.toggle} />,
          docPip.pipWindow.document.body,
        )}
    </>
  )
}

/** Shown on the main window while the call is floating in Document PiP. */
function PipPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="grid size-16 place-items-center rounded-island bg-sunken text-ink-muted [&_svg]:size-7">
        <PipIcon />
      </div>
      <div>
        <p className="text-sm font-medium">Your call is in picture-in-picture</p>
        <p className="mt-1 text-xs text-ink-muted">It's playing in the floating window.</p>
      </div>
      <Button variant="accent" onClick={onBack}>
        Bring back to window
      </Button>
    </div>
  )
}

/**
 * Top-center "✋ Lower hand" pill while your hand is raised (WhatsApp convention):
 * a persistent, one-tap way to lower it and a clear status cue, since the raise
 * action itself now lives in the reactions picker rather than on the bar.
 */
function RaisedHandPill({
  raised,
  onLower,
  visible,
}: {
  raised: boolean
  onLower: () => void
  visible: boolean
}) {
  if (!raised) return null
  return (
    <div
      className={cn(
        'fixed inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-20 flex justify-center px-4',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && 'pointer-events-none -translate-y-[200%] opacity-0',
      )}
    >
      <button
        type="button"
        onClick={onLower}
        className="pointer-events-auto flex items-center gap-2 rounded-control bg-overlay px-4 py-2 text-sm font-medium text-warning shadow-raised backdrop-blur [&_svg]:size-4"
      >
        <HandIcon /> Lower hand
      </button>
    </div>
  )
}
