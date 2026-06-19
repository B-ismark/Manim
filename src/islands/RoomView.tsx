import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { RoomAudioRenderer, useRoomContext, useConnectionState, useParticipants } from '@livekit/components-react'
import { ConnectionState, RoomEvent } from 'livekit-client'
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
import { StageTopBar } from '@/islands/StageTopBar'
import { EffectsCarousel } from '@/islands/EffectsCarousel'
import { PinCoachmark } from '@/islands/PinCoachmark'
import { InCallIncomingBanner } from '@/islands/InCallIncomingBanner'
import { useChatMessages } from '@/features/chat/useChatMessages'
import { usePublishMeetingPresence } from '@/features/calls/usePresence'
import { useReactions } from '@/features/reactions/useReactions'
import { useBackgroundBlur } from '@/features/effects/useBackgroundBlur'
import { useNoiseFilter } from '@/features/effects/useNoiseFilter'
import { useCallSounds } from '@/features/sounds/useCallSounds'
import { useDocumentPip } from '@/features/pip/useDocumentPip'
import { useMediaSessionControls } from '@/features/pip/useMediaSessionControls'
import { useApplyBlocks } from '@/features/moderation/useApplyBlocks'
import { useSessionControl } from '@/features/session/useSessionControl'
import { useRoomStore } from '@/store/useRoomStore'
import { useEffectsUi } from '@/store/useEffectsUi'
import { Button } from '@/components/primitives'
import { HandIcon, PipIcon } from '@/components/icons'
import { useMediaDeviceWatch } from '@/features/calls/useMediaDeviceWatch'
import { isTouch } from '@/lib/device'
import { parseRoomHash } from '@/lib/roomLink'
import { prettyRoom } from '@/lib/roomName'
import { useRecentRoomsStore } from '@/store/useRecentRoomsStore'
import { cn } from '@/lib/cn'
import { addBreadcrumb, reportError } from '@/lib/report'

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
  // The LiveKit room.name is empty until the server sends it (post-connect), so the
  // joining cover would drop the room title mid-connect — a visible jump from
  // RoomRoute's cover (which has the title) to this one (which wouldn't). Use the
  // URL slug instead so both covers render the SAME title and the handoff is seamless.
  const { room: roomSlug = '' } = useParams()
  // DEV-only test seam: expose the live Room so E2E specs can drive LiveKit's
  // built-in fault simulation (room.simulateScenario('signal-reconnect')) — the
  // network transport can't be cut from the test side (CDP/setOffline don't touch
  // the established WebRTC media path). Stripped from prod builds by the DEV guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __lkRoom?: typeof room }).__lkRoom = room
    return () => {
      delete (window as unknown as { __lkRoom?: typeof room }).__lkRoom
    }
  }, [room])
  // Security material rides in the invite link's #fragment (see lib/roomLink), not
  // the store: the E2EE key keys the media, the join secret is re-advertised to the
  // user's own other devices for quick-join. A strong random key shared only via
  // the link — no typed passphrase.
  const linkSecrets = useMemo(() => parseRoomHash(window.location.hash), [])
  const e2eePassphrase = linkSecrets.e2ee
  const { active, sendReaction, handRaised, toggleHand } = useReactions()
  // Chat state is owned here (persists across the side panel opening/closing —
  // LiveKit chat history is transient and would otherwise reset on remount).
  const chat = useChatMessages()
  const blur = useBackgroundBlur()
  const noise = useNoiseFilter()
  // Uplink adaptation is left entirely to simulcast + dynacast + adaptiveStream (see
  // roomOptions): on a weak uplink WebRTC simply stops sending the higher simulcast
  // layers — subscribers pull a lower one and it auto-recovers — all WITHOUT touching
  // the capture. An earlier capture-restart LOD (useAdaptiveQuality) re-acquired the
  // camera on every Poor↔Good crossing, which blacked the preview on and off on a
  // flaky network. Removed: the simulcast path degrades gracefully with no flicker.
  const connState = useConnectionState()
  const connected = connState === ConnectionState.Connected
  // Latches true on the first successful connect. Drives the initial joining cover
  // (below): we cover until connected ONCE, then never again — so mid-call reconnects
  // fall through to the ConnectionBanner and can't strand a full-screen cover.
  const [everConnected, setEverConnected] = useState(false)
  useEffect(() => {
    if (connected) setEverConnected(true)
  }, [connected])

  // Remember this room for one-tap rejoin from the home page, once we've actually
  // connected (so a failed/abandoned join isn't recorded). Carries the link secrets
  // so rejoin reconstructs the full invite.
  const recordRecent = useRecentRoomsStore((s) => s.record)
  useEffect(() => {
    if (!everConnected || !roomSlug) return
    recordRecent({
      slug: roomSlug,
      name: prettyRoom(roomSlug),
      ts: Date.now(),
      secret: linkSecrets.secret,
      e2ee: linkSecrets.e2ee,
    })
  }, [everConnected, roomSlug, linkSecrets, recordRecent])
  // Desktop auto-PiP: float the app into a Document-PiP window when the tab is
  // backgrounded. Mobile PiP is manual only (a tile in More) — gesture-less
  // auto-PiP crashed mobile WebKit, so it was removed.
  const docPip = useDocumentPip(connected)
  useCallSounds()
  useApplyBlocks()
  // Detect mid-call device loss (camera unplugged / mic disconnected / OS revoke)
  // and surface it instead of letting the tile silently freeze (E5).
  useMediaDeviceWatch()

  // Breadcrumb connection-state transitions so a reported error carries the recent
  // connection history (E1) — e.g. "errored right after a Reconnecting blip".
  useEffect(() => {
    addBreadcrumb('connection state', { state: connState })
  }, [connState])

  // Activate end-to-end encryption when a passphrase was set at prejoin. The key
  // is already configured on the room's keyProvider (see roomOptions).
  //
  // The padlock MUST reflect the REAL E2EE state, not merely "a passphrase was
  // typed": enabling can fail (unsupported browser, SharedArrayBuffer unavailable,
  // worker load error). A badge that lies — claiming encryption while media flows
  // in the clear — is worse than no badge. So we only mark the call encrypted once
  // setE2EEEnabled actually resolves, and on failure we drop the badge and warn
  // loudly rather than swallowing the error.
  const [e2eeActive, setE2eeActive] = useState(false)
  useEffect(() => {
    if (!e2eePassphrase) return
    let cancelled = false
    room
      .setE2EEEnabled(true)
      .then(() => {
        if (!cancelled) setE2eeActive(true)
      })
      .catch((e) => {
        if (cancelled) return
        setE2eeActive(false)
        // This is a security-correctness failure (media flows unencrypted while the
        // user expected E2EE) — it must NOT vanish silently. Warn the user AND
        // report it so its real-world rate is measurable (E1/E2).
        reportError(e, { context: 'e2ee-enable' })
        toast(
          'Encryption couldn’t be turned on — this call is NOT end-to-end encrypted.',
          'danger',
        )
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Surface E2EE key MISMATCH (S4c). The key is delivered by the invite link, so a
  // mismatch only happens when someone opened a stale/wrong link — but when it does,
  // that peer silently can't decode our media (frames are dropped), and nothing else
  // tells either side why "I can't see/hear you". LiveKit fires EncryptionError on a
  // decrypt failure; warn (throttled) with the fix. Local encryption is still on, so
  // this doesn't touch the padlock — it flags a REMOTE peer on a different key.
  const lastE2eeWarn = useRef(0)
  useEffect(() => {
    if (!e2eePassphrase) return
    const onError = () => {
      const now = Date.now()
      if (now - lastE2eeWarn.current < 15_000) return // throttle: errors burst per-frame
      lastE2eeWarn.current = now
      toast(
        'Encryption mismatch — someone may be on a different invite link, so they can’t see or hear you. Re-share your link.',
        'danger',
      )
    }
    room.on(RoomEvent.EncryptionError, onError)
    return () => {
      room.off(RoomEvent.EncryptionError, onError)
    }
  }, [room, e2eePassphrase])
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
  const { chromeVisible, setChromeHold, stageHandlers } = useStageChrome()
  // Opening the effects carousel must reveal + pin the chrome. The Effects button
  // lives on the self-view tile (always visible on touch), but the carousel is a
  // sibling of the auto-hiding control bar — so after the 4s auto-hide a tap would
  // flip carouselOpen with the chrome gone, and the strip never appeared. Treat an
  // open carousel like an open menu: hold the chrome up until it closes.
  useEffect(() => {
    setChromeHold(carouselOpen)
  }, [carouselOpen, setChromeHold])
  // Leave via the control bar is instant by design (a sound choice on desktop), but
  // on a thumb-zone mobile bar a fat-finger drops you and rejoin can mean re-knocking
  // the waiting room. Pair the explicit Leave button with an undo toast that rejoins
  // the same room (autojoin → no second prejoin). End-for-everyone, host-end, handoff
  // and the solo-auto-leave keep the plain doLeave — those aren't accidental.
  const navigate = useNavigate()
  const leaveWithUndo = useCallback(() => {
    const slug = room.name
    void doLeave()
    toast('You left the call', 'neutral', {
      duration: 8000,
      action: {
        label: 'Rejoin',
        onClick: () => navigate(`/r/${encodeURIComponent(slug)}`, { state: { autojoin: true } }),
      },
    })
  }, [doLeave, navigate, room.name])
  // Mic/camera/hang-up buttons in native PiP + OS media controls.
  useMediaSessionControls(doLeave)
  // End a forgotten call left running alone.
  useSoloAutoLeave(doLeave)
  // Advertise this call to the user's other signed-in devices (quick-join). Carry
  // the link secrets so the other device can reconstruct the full invite link and
  // pass the join-secret gate — the presence channel is owner-only (Realtime RLS).
  usePublishMeetingPresence(room.name, linkSecrets)

  // Focus restoration. A forced rejoin / handoff / merge remounts this subtree —
  // the control that triggered it (a menu item, the handoff banner button) is now
  // gone, so keyboard focus falls back to <body> and a screen reader announces
  // nothing about the new context. On the FIRST connect after mount, move focus
  // to the call region so it announces "In call" and keyboard nav resumes from a
  // known point. Guarded to fire once per mount, so a mid-call network reconnect
  // (Reconnecting → Connected) never yanks focus away from, say, the chat input.
  const callRegionRef = useRef<HTMLDivElement>(null)
  const didFocusOnConnect = useRef(false)
  useEffect(() => {
    if (connected && !didFocusOnConnect.current) {
      didFocusOnConnect.current = true
      callRegionRef.current?.focus({ preventScroll: true })
    }
  }, [connected])

  // Cover everything up to the FIRST connect with the joining screen (same label as
  // RoomRoute's so the knock→connect handoff doesn't jump). Crucially this covers
  // Disconnected too — on mount, before LiveKit's connect effect runs, the room
  // reports Disconnected, and rendering the full call tree for that frame flashed the
  // chrome/control-bar/stage in, then yanked it back to the cover when Connecting
  // began. Gate on `everConnected` so reconnects AFTER the first connect fall through
  // to ConnectionBanner instead (a stuck full-screen cover was a past-reverted bug).
  if (!everConnected && connState !== ConnectionState.Connected) {
    return <JoiningScreen room={room.name || roomSlug} />
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
      <CallStatusBar encrypted={e2eeActive} visible={chromeVisible} />
      <StageTopBar visible={chromeVisible} />
      <PinCoachmark />
      <RaisedHandPill raised={handRaised} onLower={toggleHand} visible={chromeVisible} />

      {sameNameOther && <HandoffBanner onSwitch={switchToThisDevice} />}
      <WaitingRoomBanner active={isHost && waiting} />
      <InCallIncomingBanner isHost={isHost} onMerge={mergeInto} />

      <div
        {...stageHandlers}
        // Programmatic focus target after a (re)join — see the focus-restoration
        // effect above. tabIndex=-1 keeps it out of the Tab sequence (it's only
        // focused in code); the label is what a screen reader announces on landing.
        ref={callRegionRef}
        tabIndex={-1}
        aria-label="In call"
        className={cn(
          'mn-fade flex min-h-0 flex-1 flex-col outline-none transition-[padding] duration-[var(--dur-base)] ease-[var(--ease-island)]',
          // Fade only (no scale): scaling a container that holds live <video>
          // causes a repaint flash on connect. transition is for the panel reflow.
          panel && 'md:pr-[20rem] lg:pr-[22rem] xl:pr-[25rem]',
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
        onLeave={leaveWithUndo}
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
        'fixed inset-x-0 top-[max(5.5rem,calc(env(safe-area-inset-top)+5rem))] z-20 flex justify-center px-4',
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
