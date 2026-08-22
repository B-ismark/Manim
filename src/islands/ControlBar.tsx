import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocalParticipant, useMediaDeviceSelect, useRoomContext } from '@livekit/components-react'
import { toast } from '@/store/useToastStore'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownItem,
  Island,
  IconButton,
  Popover,
  Sheet,
  Toggle,
  Tooltip,
} from '@/components/primitives'
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  ChevronUpIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
  GridIcon,
  HandIcon,
  LeaveIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  PipIcon,
  ReactionIcon,
  ScreenShareIcon,
  SettingsIcon,
  SpeakerLayoutIcon,
  EffectsIcon,
  KeyboardIcon,
  EyeOffIcon,
  EyeIcon,
  SlidersIcon,
  SortIcon,
  WaitingRoomIcon,
  SoundOnIcon,
  AnnotateIcon,
  CheckIcon,
  CloseIcon,
} from '@/components/icons'
import { DeviceSettings, DeviceRow } from '@/islands/DeviceMenu'
import { EffectsDialog } from '@/islands/BackgroundEffects'
import { SettingsDialog } from '@/islands/Settings'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import type { NoiseFilterControls } from '@/features/effects/useNoiseFilter'
import { useRoomStore } from '@/store/useRoomStore'
import { useDeviceStore, type StoredDeviceKind } from '@/store/useDeviceStore'
import { useAudioStore } from '@/store/useAudioStore'
import { recoverMicrophone } from '@/lib/audioRecovery'
import { useCameraToggle } from '@/lib/useCameraToggle'
import { MAX_CONCURRENT_SHARES, useScreenShare } from '@/features/calls/useScreenShare'
import { useSharePresence } from '@/lib/useSharePresence'
import { useIsTouch } from '@/lib/useIsTouch'
import { useFullscreen } from '@/lib/useFullscreen'
import { useBarDockShift } from '@/lib/panelDock'
import { useSettleGuard } from '@/lib/useSettleGuard'
import { cn } from '@/lib/cn'

export interface ControlBarProps {
  /** When false (mobile auto-hide), the bar slides out of the thumb zone. */
  chromeVisible: boolean
  /** Pin/unpin the auto-hiding chrome — held open while a menu is showing. */
  onMenuOpenChange?: (open: boolean) => void
  /**
   * Restart the auto-hide countdown. Called when the user touches the island.
   *
   * Without it the countdown only ever restarted on a STAGE tap, so the island
   * ran on a clock that ignored the user operating it: it arms on mount, and a
   * control tapped at t=3.9s got 100ms before the bar slid out from under the
   * thumb. Touching the bar is the clearest possible signal that it's wanted.
   */
  onInteract?: () => void
  /** Leave the call yourself (call continues for others). */
  onLeave: () => void
  /** Host-only: end the call for everyone. */
  onEndForEveryone: () => void
  isHost: boolean
  /** Room lock state + host toggle. */
  locked: boolean
  onToggleLock: () => void
  /** Waiting-room state + host toggle. */
  waiting: boolean
  onToggleWaiting: () => void
  sendReaction: (emoji: string) => void
  handRaised: boolean
  toggleHand: () => void
  blur: BackgroundBlurControls
  /** AI background-noise suppression (Krisp). */
  noise: NoiseFilterControls
  /** Document PiP (whole-app). Falls back to element PiP when unsupported. */
  docPip: { supported: boolean; active: boolean; toggle: () => void }
}

/**
 * Lean control bar. Mobile shows only the essentials — mic, camera, chat, More,
 * leave — with everything secondary folded into More (WhatsApp/Snapchat model).
 * Desktop additionally inlines screen-share and a single reaction button (which
 * also carries raise-hand). Camera flip + background effects live on the
 * self-view tile. STYLE.md §4/§5.
 *
 * Layout lives in More → View on both pointer types, and on touch ALSO on the
 * stage's own view chip (Stage's StageViewSwitcher) — a named control you can see
 * without opening a menu, which is the phone's primary route. Both set the same
 * `layout` value, so they can't disagree.
 */
export function ControlBar({
  chromeVisible,
  onMenuOpenChange,
  onInteract,
  onLeave,
  onEndForEveryone,
  isHost,
  locked,
  onToggleLock,
  waiting,
  onToggleWaiting,
  sendReaction,
  handRaised,
  toggleHand,
  blur,
  noise,
  docPip,
}: ControlBarProps) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const room = useRoomContext()
  // A microphone that couldn't be recovered. The mic control has to say so and
  // has to become the way back: the reported bug was "no way to re-trigger it",
  // and an ordinary unmute here re-runs the acquire that just failed.
  const micFault = useAudioStore((s) => s.micFault)
  // One entry point for starting/stopping a share — see useScreenShare's header.
  const screenShare = useScreenShare()
  // Annotation needs a share in the BIG region, not merely a share somewhere.
  // Gating on "does a share exist" left the pen enabled after the share was demoted
  // to the grid or a person was spotlighted: arming it then flipped a store flag
  // with no canvas mounted anywhere, and announced "Draw on the shared screen" to a
  // screen-reader user who had no surface at all.
  const { canAnnotate, shareSlotsFull } = useSharePresence()
  const annotateActive = useAnnotateStore((s) => s.active)
  const toggleAnnotate = useAnnotateStore((s) => s.toggle)
  const setAnnotateActive = useAnnotateStore((s) => s.setActive)
  // ONE disarm path. An armed pen with no reachable control is a mode the user
  // cannot see or exit, and it would silently re-arm the moment the next person
  // shared — so the flag follows the same condition the controls render on.
  useEffect(() => {
    if (!canAnnotate) setAnnotateActive(false)
  }, [canAnnotate, setAnnotateActive])
  // Camera toggle goes through the warm-then-release path (fast re-enable).
  const { isCameraEnabled, toggleCamera } = useCameraToggle()
  const [pipActive, setPipActive] = useState(false)
  // ONE modal at a time, by construction.
  //
  // These were five independent booleans, so nothing stopped two dialogs being open
  // together — and two Radix dialogs at the same z-index stack by DOM order, which
  // put a scrim over a live dialog and left the user with two rings of chrome and
  // no obvious way out. Opening any of them now closes whatever was open, and a
  // close is just "no modal". `setModal(null)` is the single exit.
  const [modal, setModal] = useState<
    'settings' | 'effects' | 'devices' | 'shortcuts' | 'endConfirm' | null
  >(null)
  const closeModal = useCallback(() => setModal(null), [])
  /** Radix's onOpenChange → this modal when opening, nothing when closing. */
  const modalToggle = useCallback(
    (id: NonNullable<typeof modal>) => (open: boolean) => setModal(open ? id : null),
    [],
  )
  const [moreOpen, setMoreOpen] = useState(false)
  // The audio tray. Not a Radix layer, so the DOM-based auto-hide guard in
  // useStageChrome can't see it — it needs the explicit hold below or the island
  // would slide out of the thumb zone taking an open tray with it.
  const [audioTrayOpen, setAudioTrayOpen] = useState(false)
  const touch = useIsTouch()
  useEffect(() => {
    onMenuOpenChange?.(audioTrayOpen)
  }, [audioTrayOpen, onMenuOpenChange])
  // A modal and the tray must not be up together — the modal would scrim the tray
  // it was opened from.
  useEffect(() => {
    if (modal) setAudioTrayOpen(false)
  }, [modal])
  const { supported: canFullscreen, isFullscreen, toggleFullscreen } = useFullscreen()
  // Screen share needs getDisplayMedia — absent on iOS Safari (and iOS Chrome,
  // which is WebKit underneath). Hide the control there instead of offering a
  // button that silently fails. The check lives in useScreenShare so the two
  // share controls (here and the mini player) can't disagree about it.
  const canScreenShare = screenShare.supported

  const panel = useRoomStore((s) => s.panel)
  // How far the bar has to move to clear the docked panel — usually not at all.
  // See lib/panelDock for why this replaced re-centring the bar in the leftovers.
  const { ref: barRef, shift } = useBarDockShift(panel !== null)
  // ...and the backstop for the widths where it DOES still move.
  const settleBlocks = useSettleGuard(shift)
  const setPanel = useRoomStore((s) => s.setPanel)
  const unread = useRoomStore((s) => s.unread)
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const videosFirst = useRoomStore((s) => s.videosFirst)
  const toggleVideosFirst = useRoomStore((s) => s.toggleVideosFirst)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const toggleSelfView = useRoomStore((s) => s.toggleSelfView)
  const audioOnly = useRoomStore((s) => s.audioOnly)
  const toggleAudioOnly = useRoomStore((s) => s.toggleAudioOnly)

  useEffect(() => {
    const onLeavePip = () => setPipActive(false)
    document.addEventListener('leavepictureinpicture', onLeavePip)
    return () => document.removeEventListener('leavepictureinpicture', onLeavePip)
  }, [])

  const togglePip = useCallback(async () => {
    // iOS Safari has no standard PiP API — it exposes webkitSetPresentationMode
    // on the <video> instead. This is the *manual*, gesture-driven path, which is
    // the supported way to PiP on iOS (unlike the gesture-less auto-PiP we removed,
    // which hard-crashed mobile WebKit).
    type WebkitVideo = HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void
      webkitPresentationMode?: string
    }
    try {
      // PiP shows raw (unmirrored) frames, so PiP-ing your own self-view looks
      // flipped. Prefer a remote video that's actually playing — keyed off the
      // local-cam marker the tile sets, not a fragile CSS-transform check.
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
      const playing = videos.filter((v) => v.videoWidth > 0)
      const target = (playing.find((v) => !v.hasAttribute('data-local-cam')) ??
        playing[0] ??
        videos[0]) as WebkitVideo | undefined

      // Standard API (desktop Chromium, Android Chrome).
      if (document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture()
          setPipActive(false)
        } else if (target) {
          await target.requestPictureInPicture()
          setPipActive(true)
        } else {
          toast("The mini player isn't available here", 'warning')
        }
        return
      }

      // WebKit fallback (iOS Safari / iOS Chrome).
      if (target && typeof target.webkitSetPresentationMode === 'function') {
        const inPip = target.webkitPresentationMode === 'picture-in-picture'
        target.webkitSetPresentationMode(inPip ? 'inline' : 'picture-in-picture')
        setPipActive(!inPip)
        return
      }

      toast("The mini player isn't available here", 'warning')
    } catch {
      toast("Couldn't open the mini player", 'warning')
    }
  }, [])

  const togglePanel = (tab: 'chat' | 'people') => setPanel(panel === tab ? null : tab)
  // Leaving is instant by design, so the one click it must not honour is the one
  // the pointer never aimed — the click that lands on Leave only because opening
  // the panel slid the bar under a resting cursor. The guard rejects that click
  // and disarms, so pressing again leaves immediately.
  const leaveGuarded = (e: { detail: number }) => {
    if (settleBlocks(e)) {
      toast('The controls just moved — press Leave again to confirm', 'neutral')
      return
    }
    onLeave()
  }

  // Single open/close path for the More menu so the chrome hold always tracks
  // it — including programmatic closes (controlled prop changes don't fire the
  // primitive's onOpenChange).
  const setMore = useCallback(
    (open: boolean) => {
      setMoreOpen(open)
      onMenuOpenChange?.(open)
    },
    [onMenuOpenChange],
  )
  const closeMore = () => setMore(false)

  // Desktop keyboard shortcuts (Architecture-Plan §8.6). Ignored on touch and
  // while typing / holding a modifier, so they never fight text entry or browser
  // chords. Leave/end are intentionally NOT bound — too costly to trigger by slip.
  useEffect(() => {
    if (touch) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"], select')) return
      // Don't hijack keys while a dialog/menu is open (e.g. the shortcuts dialog).
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      switch (e.key.toLowerCase()) {
        case 'm':
          void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
          break
        case 'v':
          void toggleCamera()
          break
        case 'c':
          togglePanel('chat')
          break
        case 'p':
          togglePanel('people')
          break
        case 'f':
          toggleFullscreen()
          break
        case '?':
          setModal('shortcuts')
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [touch, localParticipant, isMicrophoneEnabled, toggleCamera, toggleFullscreen, setPanel, panel])

  // Shared "More" body — rendered in a bottom sheet on mobile, a popover on
  // desktop. A reaction strip headlines the sheet; quick toggles fill a grid;
  // rich controls (effects/audio/devices) follow as labeled sections. Items
  // that live on the inline bar at wider widths hide here at the matching
  // breakpoint, so nothing duplicates.
  const moreContent = (
    <div className="flex flex-col">
      <div className="mb-2 pointer-fine:hidden">
        <p className="px-1 pb-1 text-xs font-medium text-ink-subtle">React</p>
        <div className="flex flex-wrap items-center justify-center gap-1">
          {REACTION_EMOJI.map((e) => (
            <IconButton
              key={e}
              label={`React ${e}`}
              icon={<span className="text-xl">{e}</span>}
              onClick={() => {
                sendReaction(e)
                closeMore()
              }}
            />
          ))}
          {/* Raise hand = a sticky reaction, so it sits with the others. */}
          <IconButton
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            icon={<HandIcon />}
            tone={handRaised ? 'accent' : 'neutral'}
            active={handRaised}
            onClick={() => {
              toggleHand()
              closeMore()
            }}
          />
        </div>
      </div>

      <p className="px-1 pb-1 text-xs font-medium text-ink-subtle">Quick actions</p>
      <div className="grid grid-cols-4 gap-1">
        {/* Screen share — touch only here; the desktop bar inlines it.

            Absent, not dimmed, where `getDisplayMedia` is missing. That is every
            real phone: no mobile browser implements screen capture (WebKit never
            has, so iOS Safari and iOS Chrome are both out, and neither Chrome nor
            Firefox for Android has either — capture there goes through ReplayKit /
            MediaProjection, native APIs a web page cannot reach). A control that
            cannot ever work is not worth a slot in a four-column grid a thumb has
            to aim at, so it isn't offered at all rather than offered greyed out.
            `useScreenShare().supported` is the one check, shared with the mini
            player's Share again so the two can never disagree. */}
        {canScreenShare && (
          <GridTile
            className="pointer-fine:hidden"
            icon={<ScreenShareIcon />}
            label={shareSlotsFull ? 'Share screen (in use)' : 'Share screen'}
            active={screenShare.enabled}
            disabled={shareSlotsFull}
            onClick={() => {
              screenShare.toggle()
              closeMore()
            }}
          />
        )}
        {/* Grid/Speaker moved into the unified "View" control below (layout + density
            in one place). PiP/Full stay here — they're window actions, not layouts. */}
        {/* PiP — floats the call into an OS window. Desktop uses Document-PiP
            (whole-app); mobile + unsupported desktop fall back to element PiP. This
            is manual/tap-driven on purpose: gesture-less auto-PiP crashed mobile. */}
        <GridTile
          icon={<PipIcon />}
          label="Mini player"
          active={docPip.supported ? docPip.active : pipActive}
          onClick={() => {
            if (docPip.supported) docPip.toggle()
            else void togglePip()
            closeMore()
          }}
        />
        {/* Hidden where the platform has no fullscreen at all (iPhone Safari) —
            same call screen-share makes on iOS. It used to render there and throw. */}
        {canFullscreen && (
          <GridTile
            icon={isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            label="Full screen"
            active={isFullscreen}
            onClick={() => {
              toggleFullscreen()
              closeMore()
            }}
          />
        )}
        {isHost && (
          <GridTile
            icon={<LockIcon />}
            label="Lock room"
            active={locked}
            onClick={onToggleLock}
          />
        )}
        {isHost && (
          <GridTile
            icon={<WaitingRoomIcon />}
            label="Waiting room"
            active={waiting}
            onClick={onToggleWaiting}
          />
        )}
      </div>

      {/* View — Speaker (one large feed) or Grid (the gallery). Two values, no
          density row: the "gallery size" chips (Auto / 4 / 9 / 16) that used to sit
          under this were clamped to the fit-to-viewport answer anyway, so on real
          viewports they either did nothing or paginated a page with room to spare.
          Tile density follows the viewport — see lib/tileGrid.

          One `layout` value on both pointer types. Touch used to drive a page INDEX
          from here instead (speaker was page 0 of a horizontal sequence), so these
          buttons meant something different depending on what you were holding, and
          any new surface had to reimplement the mapping. The stage's view chip and
          this control now set the same thing. */}
      <div className="mt-2 border-t border-line pt-2">
        <p className="px-1 pb-1 text-xs font-medium text-ink-subtle">View</p>
        <div className="flex gap-1" role="group" aria-label="View layout">
          {(
            [
              { value: 'speaker', label: 'Speaker', icon: <SpeakerLayoutIcon /> },
              { value: 'grid', label: 'Grid', icon: <GridIcon /> },
            ] as const
          ).map((opt) => {
            const active = layout === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setLayout(opt.value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-control py-1.5 text-sm font-medium transition-colors [&_svg]:size-4',
                  'pointer-coarse:min-h-11',
                  active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink hover:bg-line',
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* A short action list (Google model) — heavy controls live in dialogs, so
          the menu never needs to scroll. */}
      <div className="mt-1 flex flex-col border-t border-line pt-1">
        <MenuRow
          icon={<EffectsIcon />}
          label="Backgrounds & effects"
          onClick={() => {
            setModal('effects')
            closeMore()
          }}
        />
        <MenuRow
          icon={<SlidersIcon />}
          label="Audio & video"
          onClick={() => {
            setModal('devices')
            closeMore()
          }}
        />
        <MenuRow
          icon={selfViewHidden ? <EyeIcon /> : <EyeOffIcon />}
          label={selfViewHidden ? 'Show self view' : 'Hide self view'}
          active={selfViewHidden}
          onClick={() => {
            toggleSelfView()
            closeMore()
          }}
        />
        <MenuRow
          icon={<SortIcon />}
          label="Videos first"
          active={videosFirst}
          onClick={() => {
            toggleVideosFirst()
            closeMore()
          }}
        />
        {/* This toggles whether we DECODE others' video — renamed off "Audio-only
            mode" because it read as (and sat next to) the "Audio & video" device
            picker, the exact confusion users reported. Framed as incoming video
            (Discord "Allow incoming video" / Skype), with a data-saver hint. */}
        <MenuRow
          icon={audioOnly ? <CameraIcon /> : <CameraOffIcon />}
          label={audioOnly ? 'Turn on incoming video' : 'Turn off incoming video (save data)'}
          active={audioOnly}
          onClick={() => {
            toggleAudioOnly()
            closeMore()
          }}
        />
        <div className="my-1 border-t border-line" />
        {/* Host-only, touch-only: the desktop bar has this behind the leave caret,
            which is too small to aim at with a thumb. Still routed through the
            confirm dialog — this is the one action in the sheet that can't be undone. */}
        {isHost && touch && (
          <MenuRow
            icon={<LeaveIcon />}
            label="End call for everyone"
            danger
            onClick={() => {
              setModal('endConfirm')
              closeMore()
            }}
          />
        )}
        <MenuRow
          icon={<SettingsIcon />}
          label="Settings"
          onClick={() => {
            setModal('settings')
            closeMore()
          }}
        />
        {/* Keyboard shortcuts — desktop (mouse) only. */}
        <div className="hidden pointer-fine:block">
          <MenuRow
            icon={<KeyboardIcon />}
            label="Keyboard shortcuts"
            onClick={() => {
              setModal('shortcuts')
              closeMore()
            }}
          />
        </div>
      </div>
    </div>
  )

  /** The island's control row. Rendered bare when collapsed, and as the tray's
   *  last row when the audio tray is open — same buttons, same order, one place. */
  const barRow = (
    <>
        {/* The room-locked indicator used to sit here as a 36px pill. It's status,
            not a control, so it moved to TopStack (RoomLockedPill) — which is where
            the layering rules say pills belong, and which gets 42px back for the
            thumb targets. At 375px the host bar needed 372px of a 343px island
            before this, and 414px with the pill: both were spilling off screen. */}

        {/* Mic — toggle + a caret (desktop) that opens the audio device picker right
            at the button (Meet/Zoom/Teams pattern), so device controls are never
            hidden in a menu. Touch reaches the same picker via the Output button and
            "Audio & video" in More. */}
        <div className="flex items-center gap-0.5">
          <Tooltip
            content={
              micFault
                ? 'Microphone unavailable — tap to retry'
                : isMicrophoneEnabled
                  ? 'Mute'
                  : 'Unmute'
            }
          >
            <IconButton
              // Never claim "Unmute microphone" for a control that cannot
              // unmute. During a fault the label, the tooltip and the press all
              // describe the same thing: retrying the device.
              label={
                micFault
                  ? 'Microphone unavailable, retry'
                  : isMicrophoneEnabled
                    ? 'Mute microphone'
                    : 'Unmute microphone'
              }
              icon={
                micFault ? (
                  <span className="relative inline-flex">
                    <MicOffIcon />
                    {/* Amber on the danger fill — a red dot on a red button says
                        nothing. Ringed in the fill colour so it reads as a badge
                        rather than part of the glyph. */}
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-1 size-2 rounded-full bg-warning ring-2 ring-danger"
                    />
                  </span>
                ) : isMicrophoneEnabled ? (
                  <MicIcon />
                ) : (
                  <MicOffIcon />
                )
              }
              tone={micFault || !isMicrophoneEnabled ? 'danger' : 'neutral'}
              active={!!micFault || !isMicrophoneEnabled}
              onClick={() => {
                if (micFault) {
                  void recoverMicrophone(room, true).then((r) => {
                    // A retry that quietly does nothing is the bug being fixed
                    // here — say so when it fails again.
                    if (!r.ok) {
                      toast(
                        r.reason === 'blocked'
                          ? 'Microphone access is blocked in your browser settings'
                          : 'Still no microphone — check that one is connected',
                        'danger',
                      )
                    }
                  })
                  return
                }
                void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
              }}
            />
          </Tooltip>
          {/* Rendered on `!touch`, NOT via `hidden pointer-fine:inline-flex` — that
              class pair is INERT on an IconButton and this caret was showing up on
              phones because of it. `cn()` is a plain joiner, so the className is
              appended after IconButton's own base `inline-flex`; Tailwind emits
              `.hidden` before `.inline-flex`, the specificity ties, and source order
              hands it to `inline-flex`. Same trap the screen-share button below
              documents. A caret is the wrong control for a thumb anyway: it opens a
              popover full of nested dropdowns, which is what the mobile device
              picker rework replaces. Touch reaches every one of these devices via
              the Output button and "Audio & video" in More. */}
          {!touch && (
            <DeviceCaret label="Audio options">
              <AudioDevicePanel noise={noise} />
            </DeviceCaret>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip content={isCameraEnabled ? 'Stop video' : 'Start video'}>
            <IconButton
              label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              icon={isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
              tone={isCameraEnabled ? 'neutral' : 'danger'}
              active={!isCameraEnabled}
              onClick={() => void toggleCamera()}
            />
          </Tooltip>
          {/* Desktop only — same inert-class trap as the audio caret above. */}
          {!touch && (
            <DeviceCaret label="Camera options">
              <CameraDevicePanel />
            </DeviceCaret>
          )}
        </div>

        {/* Audio routing — TOUCH ONLY, and the control users hunt for most on mobile.
            The button STATES the route it's on ("AirPods") rather than showing a
            generic speaker glyph, so "where is my audio going?" is answered without
            opening anything, and it opens the island's own tray.

            There is deliberately no desktop counterpart. A speaker button used to
            sit here on `!touch` as well, opening a popover — and that popover was
            `AudioDevicePanel`, the very same component the mic caret two controls to
            the left already opens. Not a similar panel: the same one, same props,
            mic row and speaker row and Bluetooth and noise. So the bar carried two
            controls that did exactly one thing, which is also the ambiguity
            AudioDevicePanel's own comments were working around. Every desktop app
            we compare against (Meet, Teams, Zoom) hangs speaker choice off the mic's
            caret for this reason. Touch is the case that genuinely needs its own
            control: there are no carets there at all.

            Removing it also gives the desktop bar back ~54px, which is not spare
            change — lib/panelDock's whole `xl` threshold exists because the bar was
            wider than the prototype measured, and its docs note the bar grows every
            time a control is added. This is the first time one has come off. */}
        {touch && (
          // Folded away below 360px, where six controls cannot fit: 5 x 44px plus
          // gaps and padding is 268 of the 288 available at 320px, and adding a
          // sixth makes 318. More -> "Audio & video" reaches every one of these
          // devices there. A <span> wrapper, because `hidden` on a component with
          // its own base display class is inert (see the device carets below).
          <span className="hidden min-[360px]:inline-flex">
            <AudioRouteButton open={audioTrayOpen} onToggle={() => setAudioTrayOpen((o) => !o)} />
          </span>
        )}

        {/* Screen share — desktop (mouse) only; folded into More on touch. Hidden
            where getDisplayMedia is unavailable (iOS).

            Gated on `!touch` rather than the `hidden pointer-fine:inline-flex`
            class it used to carry: IconButton's own base `inline-flex` beat
            `hidden` in the cascade, so this stayed visible on touch and phones
            showed the control TWICE — here and in the More sheet. Rendering
            conditionally can't lose a specificity race. */}
        {canScreenShare && !touch && (
          <Tooltip
            content={
              shareSlotsFull
                ? `${MAX_CONCURRENT_SHARES} people are already sharing`
                : screenShare.enabled
                  ? 'Stop sharing'
                  : 'Share screen'
            }
          >
            <IconButton
              label={
                screenShare.enabled
                  ? 'Stop screen share'
                  : shareSlotsFull
                    ? `Share screen, unavailable — ${MAX_CONCURRENT_SHARES} people are already sharing`
                    : 'Share screen'
              }
              icon={<ScreenShareIcon />}
              tone="neutral"
              active={screenShare.enabled}
              // aria-disabled, NOT disabled. A `disabled` button carries
              // `pointer-events-none` here, which kills both the tooltip and the
              // native title — so the one control that most needs to explain itself
              // would have been a grey circle with no reason attached, and
              // unreachable by keyboard too. Left interactive: hover explains,
              // focus explains, and the press falls through to useScreenShare's
              // capacity toast, which explains a third time.
              aria-disabled={shareSlotsFull}
              className={cn(shareSlotsFull && 'opacity-50')}
              onClick={screenShare.toggle}
            />
          </Tooltip>
        )}

        {/* Annotate — only while someone is actually sharing, and desktop only:
            drawing has to capture touch, which would fight the control bar's
            tap-to-reveal. Touch devices still SEE everyone's strokes. */}
        {canAnnotate && (
          <Tooltip content={annotateActive ? 'Stop annotating' : 'Draw on the shared screen'}>
            <IconButton
              label={annotateActive ? 'Stop annotating' : 'Annotate shared screen'}
              icon={<AnnotateIcon />}
              tone="neutral"
              active={annotateActive}
              onClick={toggleAnnotate}
            />
          </Tooltip>
        )}

        {/* Chat — always visible (Tier-1 primary), with unread badge. */}
        <Tooltip content="Chat">
          <span className="relative inline-flex">
            <IconButton
              label="Open chat"
              icon={<ChatIcon />}
              tone="neutral"
              active={panel === 'chat'}
              onClick={() => togglePanel('chat')}
            />
            {unread > 0 && panel !== 'chat' && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-control bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        </Tooltip>

        {/* Reactions (desktop inline; folded into More on touch). One button —
            it also carries raise-hand. Layout switching lives in More / top chip. */}
        <span className="hidden pointer-fine:inline-flex">
          <ReactionButton onPick={sendReaction} handRaised={handRaised} onToggleHand={toggleHand} />
        </span>

        {/* More — bottom sheet on mobile (thumb-reachable), popover on desktop.
            Both render the same body; see moreContent above. */}
        {touch ? (
          <>
            <IconButton
              label="More options"
              icon={<MoreIcon />}
              tone="neutral"
              active={moreOpen}
              onClick={() => setMore(true)}
            />
            <Sheet open={moreOpen} onOpenChange={setMore} side="bottom" title="More">
              {moreContent}
            </Sheet>
          </>
        ) : (
          <Popover
            open={moreOpen}
            onOpenChange={setMore}
            side="top"
            align="end"
            trigger={
              <IconButton label="More options" icon={<MoreIcon />} tone="neutral" active={moreOpen} />
            }
          >
            <div className="max-h-[min(70vh,32rem)] w-80 max-w-[85vw] overflow-y-auto p-2 no-scrollbar">
              {moreContent}
            </div>
          </Popover>
        )}

        <SettingsDialog open={modal === 'settings'} onOpenChange={modalToggle('settings')} />
        <EffectsDialog open={modal === 'effects'} onOpenChange={modalToggle('effects')} controls={blur} />
        <Dialog
          open={modal === 'devices'}
          onOpenChange={modalToggle('devices')}
          title="Audio & video"
          description="Choose your camera, microphone and speaker, and tune noise suppression."
        >
          <div className="flex flex-col gap-4">
            <DeviceSettings />
            <div className="border-t border-line pt-1">
              <NoiseSuppression controls={noise} />
            </div>
          </div>
        </Dialog>
        <ShortcutsDialog open={modal === 'shortcuts'} onOpenChange={modalToggle('shortcuts')} />
        <Dialog
          open={modal === 'endConfirm'}
          onOpenChange={modalToggle('endConfirm')}
          title="End the call for everyone?"
          description="This disconnects all participants and can't be undone. To just leave yourself, use Leave instead."
        >
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => closeModal()}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                closeModal()
                onEndForEveryone()
              }}
            >
              <LeaveIcon />
              End for everyone
            </Button>
          </div>
        </Dialog>

        <div className="mx-1 h-7 w-px bg-line" aria-hidden />

        {isHost && !touch ? (
          // Split control: leaving (call continues) is the primary action; ending
          // for everyone is tucked behind the caret. Styled as one danger pill.
          //
          // DESKTOP ONLY. On touch the caret is a 26px target — under every touch
          // guideline — and the pill costs 92px of a bar that has 343px at 375px and
          // was overflowing by 29px because of it. "End for everyone" is a full-width
          // row in More on touch instead, which is both reachable and safer to aim at.
          <div className="flex h-11 items-stretch overflow-hidden rounded-control">
            <Tooltip content="Leave — the call continues">
              <button
                type="button"
                onClick={leaveGuarded}
                aria-label="Leave call"
                className="flex items-center gap-2 bg-danger pl-4 pr-3.5 text-sm font-medium text-danger-ink transition-colors hover:bg-danger-hover [&_svg]:size-5"
              >
                <LeaveIcon />
                <span className="hidden pointer-fine:inline">Leave</span>
              </button>
            </Tooltip>
            <span className="w-px bg-danger-ink/25" aria-hidden />
            <DropdownMenu
              side="top"
              align="end"
              onOpenChange={onMenuOpenChange}
              trigger={
                <button
                  type="button"
                  aria-label="End call for everyone"
                  className="grid place-items-center bg-danger px-2 text-danger-ink transition-colors hover:bg-danger-hover [&_svg]:size-4"
                >
                  <ChevronUpIcon />
                </button>
              }
            >
              <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={() => setModal('endConfirm')}>
                End call for everyone
              </DropdownItem>
            </DropdownMenu>
          </div>
        ) : (
          <Tooltip content="Leave">
            <IconButton label="Leave call" icon={<LeaveIcon />} tone="danger" onClick={leaveGuarded} />
          </Tooltip>
        )}
    </>
  )

  return (
    // bottom inset clears the iOS home indicator (viewport-fit=cover is set).
    // Slides out of the thumb zone when chrome is hidden (mobile tap-to-hide).
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !chromeVisible && 'translate-y-[150%] opacity-0',
      )}
    >
      <Island
        ref={barRef}
        pad="none"
        elevation="raised"
        // Capture phase, on the whole island: a press anywhere on it — including
        // one a child button stops propagating — counts as "keep this up".
        onPointerDownCapture={onInteract}
        // Slide clear of the docked panel — by the real overlap, not by half the
        // panel's width. 0 on most desktops, so the bar simply doesn't move.
        // Measured, so opening the audio tray (which reshapes the island) is
        // accounted for rather than assumed away.
        style={shift ? { transform: `translateX(-${shift}px)` } : undefined}
        className={cn(
          'rounded-control',
          'transition-transform duration-[var(--dur-base)] ease-[var(--ease-island)]',
          // With the tray open the island becomes a COLUMN whose LAST ROW is the
          // control bar. That is the whole point: there is no second element to
          // lose track of, so a picker outliving its anchor stops being a bug to
          // fix and becomes a state that cannot be constructed.
          audioTrayOpen
            ? 'flex w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden'
            : 'flex items-center gap-1.5 px-3 py-2 sm:gap-2',
          // Only interactive while shown — otherwise the off-screen bar still
          // caught taps/focus.
          chromeVisible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        {audioTrayOpen && (
          <AudioTray
            noise={noise}
            onClose={() => setAudioTrayOpen(false)}
            onAllDevices={() => {
              setAudioTrayOpen(false)
              setModal('devices')
            }}
          />
        )}
        {audioTrayOpen ? (
          <div className="flex items-center gap-1.5 border-t border-line bg-sunken px-3 py-2">{barRow}</div>
        ) : (
          barRow
        )}
      </Island>
    </div>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['M', 'Mute / unmute microphone'],
  ['V', 'Start / stop camera'],
  ['C', 'Toggle chat'],
  ['P', 'Toggle participants'],
  ['F', 'Toggle full screen'],
  ['?', 'Show this help'],
]

/** Keyboard-shortcut legend (desktop). Opened from More or by pressing "?". */
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Available on desktop while not typing.">
      <ul className="flex flex-col gap-1.5">
        {SHORTCUTS.map(([key, desc]) => (
          <li key={key} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-ink">{desc}</span>
            <kbd className="rounded-field border border-line bg-sunken px-2 py-0.5 font-mono text-xs text-ink-muted">
              {key}
            </kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

/**
 * Inline reaction picker (desktop). Emoji grid plus a raise/lower-hand toggle —
 * hand is just a sticky reaction, so it lives here rather than as its own bar
 * button. Active state reflects a raised hand so the bar shows the cue.
 */
function ReactionButton({
  onPick,
  handRaised,
  onToggleHand,
}: {
  onPick: (emoji: string) => void
  handRaised: boolean
  onToggleHand: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="center"
      trigger={
        <IconButton
          label="Reactions and raise hand"
          icon={<ReactionIcon />}
          tone={handRaised ? 'accent' : 'neutral'}
          active={open || handRaised}
        />
      }
    >
      <div className="flex items-center gap-1">
        {REACTION_EMOJI.map((e) => (
          <IconButton
            key={e}
            label={`React ${e}`}
            icon={<span className="text-xl">{e}</span>}
            onClick={() => {
              onPick(e)
              setOpen(false)
            }}
          />
        ))}
        <span className="mx-0.5 h-7 w-px bg-line" aria-hidden />
        <IconButton
          label={handRaised ? 'Lower hand' : 'Raise hand'}
          icon={<HandIcon />}
          tone={handRaised ? 'accent' : 'neutral'}
          active={handRaised}
          onClick={() => {
            onToggleHand()
            setOpen(false)
          }}
        />
      </div>
    </Popover>
  )
}

/** Background-noise suppression: a single on/off toggle. When on, the best filter
 *  the device can run is used (AI/Krisp, else the browser's built-in filter). */
function NoiseSuppression({ controls }: { controls: NoiseFilterControls }) {
  const { enabled, setEnabled } = controls
  return (
    <div className="px-2.5 py-1.5">
      <Toggle
        checked={enabled}
        onCheckedChange={setEnabled}
        label="Noise suppression"
        className="w-full justify-between"
      />
    </div>
  )
}

function MenuRow({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  /** Destructive row (end the call for everyone) — tone matches the bar's control. */
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      data-danger={danger}
      // 44px on a coarse pointer (audit F6). The More sheet is a touch-only surface
      // and these rows were ~36px — clear of WCAG 2.5.8's 24px, short of both
      // platform guidelines, and sitting next to 68px GridTiles.
      className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken pointer-coarse:min-h-11 [&_svg]:size-4 data-[active=true]:text-accent data-[danger=true]:text-danger-text"
      data-active={active}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * Small caret button that opens a device picker anchored to a bar control (the
 * mic/camera "split button" chevron). Desktop only — the caller renders it on
 * `!touch`; touch uses the Output button + More, where a full-size tap target is
 * friendlier. (It used to gate itself with a `hidden` class the cascade ignored,
 * which is how it ended up on phones — see the call site.)
 */
function DeviceCaret({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="center"
      trigger={
        <IconButton
          label={label}
          size="sm"
          tone="neutral"
          active={open}
          icon={<ChevronUpIcon />}
        />
      }
    >
      <div className="w-72 max-w-[85vw]">{children}</div>
    </Popover>
  )
}

/** Mic + speaker pickers, the Bluetooth-auto toggle, and noise suppression — the
 *  full audio panel behind the mic caret. */
function AudioDevicePanel({ noise }: { noise?: NoiseFilterControls }) {
  return (
    <div className="flex flex-col gap-3">
      <DeviceRow kind="audioinput" label="Microphone" />
      {/* "Speaker", not "Audio output" — matching DeviceSettings, and still the
          right name now that the bar's own Audio output button is gone. Touch's
          AudioRouteButton is named `Audio output: <device>`, and the reason to
          keep these two apart hasn't changed: two controls with the same
          accessible name doing different things is a real ambiguity for a screen
          reader, and Chromium's fake devices are called "Fake Default Audio
          Output", so a row named for the category collides with its own contents. */}
      <DeviceRow kind="audiooutput" label="Speaker" />
      <div className="border-t border-line pt-2">
        <BluetoothToggle />
      </div>
      {noise && (
        <div className="border-t border-line pt-1">
          <NoiseSuppression controls={noise} />
        </div>
      )}
    </div>
  )
}

/** Camera picker behind the camera caret (desktop). Flip lives on the self-view
 *  tile for touch, so it's not repeated here. */
function CameraDevicePanel() {
  return (
    <div className="flex flex-col gap-3">
      <DeviceRow kind="videoinput" label="Camera" />
    </div>
  )
}

/** Ties the tray to its trigger for assistive tech (aria-controls/expanded). */
const AUDIO_TRAY_ID = 'mn-audio-tray'

/** Minimum height for a row you tap with a thumb. WCAG 2.5.8 asks 24px and the
 *  old menu rows cleared that at ~36px, but both platform guidelines want more —
 *  44px on iOS, 48dp on Android — and these rows exist only for thumbs. */
const TOUCH_ROW = 'min-h-[3.5rem]'

/**
 * The audio route the app is currently on, as a label.
 *
 * Returns null where the platform exposes no output devices at all, which is iOS
 * Safari: no `audiooutput` in enumerateDevices, no setSinkId. That case is the
 * reason this is a hook and not a string — a control labelled "Audio output" that
 * opens a panel with no output control in it was a real finding, and the honest
 * answer is to stop claiming to route and offer what we do have (mic, noise).
 */
function useAudioRoute(): { label: string | null; canRoute: boolean } {
  const { devices, activeDeviceId } = useMediaDeviceSelect({ kind: 'audiooutput' })
  if (devices.length === 0) return { label: null, canRoute: false }
  const active = devices.find((d) => d.deviceId === activeDeviceId) ?? devices[0]
  return { label: active?.label || 'Speaker', canRoute: true }
}

/**
 * Touch trigger for the audio tray. A plain 44px icon button — NOT the labelled
 * chip the prototype drew.
 *
 * The chip was meant to answer "where is my audio going?" without opening
 * anything, and it's a good idea that does not fit. Measured at 375px: the island
 * has 343px to work with, six 44px controls plus gaps and padding come to 318, and
 * a 104px chip in place of one of them makes 378 — 35px over, spilling off both
 * screen edges. Controls don't compress to absorb it (`size-11` fixes both axes),
 * they just hang off. The route name moved into the tray's header instead, which is
 * one tap away rather than zero, and the bar keeps its thumb targets.
 *
 * The accessible name still carries the route, so a screen-reader user gets the
 * label the chip would have shown without needing the pixels.
 */
function AudioRouteButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { label, canRoute } = useAudioRoute()
  return (
    <IconButton
      // Named for what the platform can actually do: iOS Safari exposes no
      // audiooutput devices and no setSinkId, so there is no route to promise.
      label={
        canRoute && label
          ? `Audio output: ${label}. Tap to change.`
          : open
            ? 'Close audio settings'
            : 'Audio settings'
      }
      icon={<SoundOnIcon />}
      tone="neutral"
      active={open}
      // The tray is a disclosure, not a dialog — the call stays operable beside it —
      // so it needs expanded/controls rather than modal semantics.
      aria-expanded={open}
      aria-controls={AUDIO_TRAY_ID}
      onClick={onToggle}
    />
  )
}

/**
 * The audio tray — the island's body while it's open.
 *
 * One flat level. Every mobile path to a device used to be a picker inside a
 * picker: a popover holding select-style rows that each opened another popover,
 * `side="top"` on both, no max-height and no scroll container. Radix flips a panel
 * that doesn't fit, so on a short phone the inner one resolved DOWNWARD off a
 * control sitting 40px from the bottom of the screen — the "awkward drop-down".
 * Nothing here nests, so nothing can flip.
 *
 * Rows are routes first, because that's the decision a phone user is making
 * ("put it on the headset"), with the raw device string as the second line for the
 * machines that have five of them. The long tail is a door, not a nested menu:
 * "All devices" opens the full Audio & video dialog.
 *
 * No Video segment, despite the prototype showing Audio/Video tabs. Camera
 * selection on touch is a FLIP, on the self-view tile — that's what every
 * reference app does, and a camera list here would re-add the picker whose leak
 * onto phones started this. A specific camera is still reachable via All devices.
 */
function AudioTray({
  noise,
  onClose,
  onAllDevices,
}: {
  noise: NoiseFilterControls
  onClose: () => void
  onAllDevices: () => void
}) {
  const { canRoute, label } = useAudioRoute()
  return (
    <div
      id={AUDIO_TRAY_ID}
      role="group"
      aria-label="Audio settings"
      className="flex max-h-[min(60dvh,26rem)] flex-col overflow-y-auto no-scrollbar"
    >
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <h2 className="text-sm font-semibold">Audio</h2>
        {/* The route the collapsed chip would have named, where there IS room for
            it. See AudioRouteButton for why it isn't on the bar. */}
        {canRoute && label && (
          <span className="min-w-0 truncate text-xs text-ink-muted">{label}</span>
        )}
        <span className="flex-1" />
        <IconButton label="Close audio settings" size="sm" icon={<CloseIcon />} onClick={onClose} />
      </div>

      {/* Output. Absent entirely where the platform can't route (iOS Safari) rather
          than shown as an empty section. */}
      {canRoute && <DeviceRouteList kind="audiooutput" heading="Play sound through" />}

      <DeviceRouteList kind="audioinput" heading="Microphone" />

      <div className="border-t border-line">
        <TrayToggle
          label="Noise suppression"
          hint="Filters keyboards and traffic"
          checked={noise.enabled}
          onChange={noise.setEnabled}
        />
        <BluetoothTrayToggle />
      </div>

      <button
        type="button"
        onClick={onAllDevices}
        className={cn(
          'flex w-full items-center gap-3 border-t border-line px-3 text-left text-sm',
          'hover:bg-sunken [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-ink-muted',
          TOUCH_ROW,
        )}
      >
        <SlidersIcon />
        <span className="flex-1">All devices</span>
      </button>
    </div>
  )
}

/**
 * Flat, tappable device list — one row per device, the active one checked.
 *
 * Replaces the select-plus-dropdown pair for the same job. Renders nothing when
 * the platform has no devices of the kind, which is what keeps the tray honest on
 * iOS (see useAudioRoute).
 */
function DeviceRouteList({ kind, heading }: { kind: MediaDeviceKind; heading: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  const remember = useDeviceStore((s) => s.remember)
  if (devices.length === 0) return null
  const activeId = devices.find((d) => d.deviceId === activeDeviceId)?.deviceId ?? devices[0]?.deviceId
  return (
    <div className="border-t border-line first:border-t-0">
      <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {heading}
      </p>
      <ul className="flex flex-col pb-1">
        {devices.map((d) => {
          const active = d.deviceId === activeId
          return (
            <li key={d.deviceId}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  void setActiveMediaDevice(d.deviceId)
                    .then(() => remember(kind as StoredDeviceKind, d.deviceId, d.label))
                    .catch(() => toast(`Couldn't switch ${heading.toLowerCase()}`, 'danger'))
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-3 text-left [&_svg]:size-5 [&_svg]:shrink-0',
                  active ? 'text-accent' : 'text-ink hover:bg-sunken',
                  TOUCH_ROW,
                )}
              >
                <SoundOnIcon />
                <span className="min-w-0 flex-1 truncate text-sm">{d.label || 'Unnamed device'}</span>
                {active && <CheckIcon />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Full-width toggle row sized for a thumb. */
function TrayToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className={cn('flex items-center gap-3 px-3', TOUCH_ROW)}>
      <Toggle
        checked={checked}
        onCheckedChange={onChange}
        label={label}
        hint={hint}
        className="w-full justify-between"
      />
    </div>
  )
}

/** "Auto-connect Bluetooth" as a tray row. */
function BluetoothTrayToggle() {
  const autoBluetooth = useDeviceStore((s) => s.autoBluetooth)
  const setAutoBluetooth = useDeviceStore((s) => s.setAutoBluetooth)
  return (
    <TrayToggle
      label="Auto-connect Bluetooth"
      hint="Take over when a headset connects"
      checked={autoBluetooth}
      onChange={setAutoBluetooth}
    />
  )
}

/** "Auto-connect Bluetooth" preference — when on, a headset that connects takes over
 *  audio automatically (useAudioDeviceAutoswitch). */
function BluetoothToggle() {
  const autoBluetooth = useDeviceStore((s) => s.autoBluetooth)
  const setAutoBluetooth = useDeviceStore((s) => s.setAutoBluetooth)
  return (
    <div className="px-2.5 py-1.5">
      <Toggle
        checked={autoBluetooth}
        onCheckedChange={setAutoBluetooth}
        label="Auto-connect Bluetooth"
        className="w-full justify-between"
      />
    </div>
  )
}

/** Quick-action tile in the More grid: round icon over a small label. */
function GridTile({
  icon,
  label,
  active,
  disabled,
  onClick,
  className,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  /** Greys the tile and blocks the press, keeping it in place. A quick action that
   *  vanishes when unavailable moves every tile after it under the user's thumb. */
  disabled?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center gap-1 rounded-field px-1 py-2 hover:bg-sunken',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-11 place-items-center rounded-control [&_svg]:size-5',
          active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink',
        )}
      >
        {icon}
      </span>
      <span className={cn('text-center text-[11px] leading-tight', active ? 'text-accent' : 'text-ink-muted')}>
        {label}
      </span>
    </button>
  )
}

