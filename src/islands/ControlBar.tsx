import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
import { ReturnFocusContext } from '@/components/primitives/useReturnFocus'
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  ChevronLeftIcon,
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
  EyeIcon,
  SlidersIcon,
  SortIcon,
  WaitingRoomIcon,
  SoundOnIcon,
  AnnotateIcon,
  CheckIcon,
  ChevronRightIcon,
} from '@/components/icons'
import { DeviceSettings, DeviceRow, useSwitchDevice } from '@/islands/DeviceMenu'
import { BackgroundEffects, EffectsDialog } from '@/islands/BackgroundEffects'
import { SettingsContent, SettingsDialog } from '@/islands/Settings'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import type { NoiseFilterControls } from '@/features/effects/useNoiseFilter'
import { useRoomStore } from '@/store/useRoomStore'
import { useDeviceStore } from '@/store/useDeviceStore'
import { useAudioStore } from '@/store/useAudioStore'
import { recoverMicrophone } from '@/lib/audioRecovery'
import { useCameraToggle } from '@/lib/useCameraToggle'
import { MAX_CONCURRENT_SHARES, useScreenShare } from '@/features/calls/useScreenShare'
import { useSharePresence } from '@/lib/useSharePresence'
import { useIsTouch } from '@/lib/useIsTouch'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useChatCompanion } from '@/lib/chatCompanion'
import { useRail, useRailTwoCol } from '@/lib/chromeBands'
import { useFullscreen } from '@/lib/useFullscreen'
import { useBarDockShift } from '@/lib/panelDock'
import { useSettleGuard } from '@/lib/useSettleGuard'
import { cn } from '@/lib/cn'
import { useShortcutStore } from '@/store/useShortcutStore'
import { toggleDevice } from '@/lib/deviceToggle'

export interface ControlBarProps {
  /** When false (mobile auto-hide), the bar slides out of the thumb zone. */
  chromeVisible: boolean
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
  /** Host: show earlier chat to people who join later (room flag, default on). */
  chatHistory: boolean
  onToggleChatHistory: () => void
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
  onInteract,
  onLeave,
  onEndForEveryone,
  isHost,
  locked,
  onToggleLock,
  waiting,
  onToggleWaiting,
  chatHistory,
  onToggleChatHistory,
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
  const moreOpen = useRoomStore((s) => s.moreOpen)
  const setMoreOpen = useRoomStore((s) => s.setMoreOpen)
  // A closed call leaves nothing open behind it for the next one.
  useEffect(() => () => setMoreOpen(false), [setMoreOpen])
  const moreRef = useRef<HTMLButtonElement>(null)
  const touch = useIsTouch()
  // A desktop window narrower than the full bar — 400% zoom on a 1280px screen is
  // 320 CSS px (WCAG reflow). It used to run off both edges, taking Mute and End
  // for everyone with it. Narrow, it keeps mic, camera, chat, More and Leave, and
  // the rest moves into More exactly as it does on touch. The threshold is the
  // WIDEST bar plus its margins: a host during a share (Annotate and the split
  // Leave both showing) measures ~614px and the island sits 16px in from each
  // edge, so anything under ~646px clipped it. 680 leaves room for one more
  // control; add one and re-measure (24-reflow-and-layers sweeps the widths).
  const narrowBar = useMediaQuery('(max-width: 679px)') && !touch
  // A phone on its side: the bar becomes a column down the right edge (chromeBands).
  const rail = useRail()
  // A rail too short for one column wraps into two (lib/chromeBands).
  const twoCol = useRailTwoCol()
  const companion = useChatCompanion()
  const companionOpen = companion.mode !== 'none'
  const compact = touch || narrowBar
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
          // Every feed has the browser's own PiP turned off (lib/mediaGuards);
          // this is the app opening it on purpose.
          target.disablePictureInPicture = false
          await target.requestPictureInPicture()
          setPipActive(true)
        } else {
          toast("The mini player isn’t available here", 'warning')
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

      toast("The mini player isn’t available here", 'warning')
    } catch {
      toast("Couldn’t open the mini player", 'warning')
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

  // The touch chrome stays up while More is open because RoomView's overlayOpen()
  // sees the sheet in the DOM; nothing here has to report it.
  const setMore = setMoreOpen
  const closeMore = () => setMore(false)
  // Which page of the phone's More sheet is showing. Every open starts at the top.
  type MorePage = 'main' | 'av' | 'effects' | 'settings' | 'host'
  const [morePageRaw, setMorePageRaw] = useState<MorePage>('main')
  // Losing host while its page is open drops you back to the list.
  const morePage: MorePage = morePageRaw === 'host' && !isHost ? 'main' : morePageRaw
  // Which row opened the current page, so Back can hand focus back to it.
  const moreOpener = useRef<string | null>(null)
  const moreBody = useRef<HTMLDivElement>(null)
  const moreMoved = useRef(false)
  const setMorePage = (next: MorePage, opener?: string) => {
    if (opener) moreOpener.current = opener
    moreMoved.current = true
    setMorePageRaw(next)
  }
  // Every open starts at the top (reset on open, so a closing sheet doesn't swap
  // back to the list mid-animation).
  useEffect(() => {
    if (moreOpen) setMorePageRaw('main')
  }, [moreOpen])
  // A page change unmounts whatever had focus; put it somewhere a screen reader
  // will announce: Back on a page, the row you came from on the list.
  useLayoutEffect(() => {
    if (!moreMoved.current) return
    moreMoved.current = false
    const sheet = moreBody.current?.closest<HTMLElement>('[role="dialog"]')
    if (!sheet) return
    const target =
      morePage === 'main'
        ? sheet.querySelector<HTMLElement>(`[data-more-row="${moreOpener.current ?? ''}"]`)
        : sheet.querySelector<HTMLElement>('button[aria-label="Back"]')
    target?.focus()
  }, [morePage])

  // Desktop keyboard shortcuts (Architecture-Plan §8.6). Ignored on touch and
  // while typing / holding a modifier, so they never fight text entry or browser
  // chords. Leave/end are intentionally NOT bound — too costly to trigger by slip.
  const shortcutsOn = useShortcutStore((s) => s.enabled)
  useEffect(() => {
    if (touch || !shortcutsOn) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"], select')) return
      // Don't hijack keys while a modal dialog or a menu is open (e.g. the
      // shortcuts dialog), or while focus is inside a popover or the side panel.
      // Only MODAL dialogs block globally (Dialog and a modal Sheet set
      // aria-modal): the docked chat/people panel is a non-modal dialog too, and
      // matching every [role=dialog] switched all shortcuts off while it was open.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return
      if (el?.closest('[role="dialog"]')) return
      switch (e.key.toLowerCase()) {
        case 'm':
          toggleDevice('microphone', !isMicrophoneEnabled, () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))
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
  }, [touch, shortcutsOn, localParticipant, isMicrophoneEnabled, toggleCamera, toggleFullscreen, setPanel, panel])

  // Shared "More" body — rendered in a bottom sheet on mobile, a popover on
  // desktop. A reaction strip headlines the sheet; quick toggles fill a grid;
  // rich controls (effects/audio/devices) follow as labeled sections. Items
  // that live on the inline bar at wider widths hide here at the matching
  // breakpoint, so nothing duplicates.
  const moreContent = (
    <div className="flex flex-col">
      <div className={cn('mb-2', !narrowBar && 'pointer-fine:hidden')}>
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
            className={cn(!narrowBar && 'pointer-fine:hidden')}
            icon={<ScreenShareIcon />}
            label={shareSlotsFull ? 'Share screen (in use)' : 'Share screen'}
            active={screenShare.enabled}
            disabled={shareSlotsFull}
            // State toggle: stays open so you see the state flip.
            onClick={() => screenShare.toggle()}
          />
        )}
        {/* A narrow desktop window has no room for Annotate on the bar. */}
        {canAnnotate && narrowBar && (
          <GridTile
            icon={<AnnotateIcon />}
            label={annotateActive ? 'Stop annotating' : 'Annotate'}
            active={annotateActive}
            onClick={() => {
              toggleAnnotate()
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
            label="Lock call"
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
        {isHost && (
          <GridTile
            icon={<ChatIcon />}
            label="Chat history"
            active={chatHistory}
            onClick={onToggleChatHistory}
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
              { value: 'grid', label: 'Gallery', icon: <GridIcon /> },
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
        {/* Switches say where they stand (On / Off), rather than flipping their
            own words: "Hide self view" read as an instruction and a state at once.
            They stay open on a click, so you see it change. */}
        <MenuRow icon={<EyeIcon />} label="Self view" state={!selfViewHidden} onClick={toggleSelfView} />
        <MenuRow icon={<SortIcon />} label="Videos first" state={videosFirst} onClick={toggleVideosFirst} />
        {/* Whether we DECODE others' video. Named for what it's for (Discord "Allow
            incoming video", a data-saver) and kept away from the "Audio & video"
            device picker it used to be confused with. */}
        <MenuRow
          icon={<CameraOffIcon />}
          label="Save data (pause incoming video)"
          state={audioOnly}
          onClick={toggleAudioOnly}
        />
        <div className="my-1 border-t border-line" />
        {/* Host-only, touch-only: the desktop bar has this behind the leave caret,
            which is too small to aim at with a thumb. Still routed through the
            confirm dialog — this is the one action in the sheet that can't be undone. */}
        {isHost && compact && (
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

  /**
   * More on a phone: a short list, with the deep stuff one level down.
   *
   * It was one grid of eighteen identical tiles, and the owner's word for it was
   * "busy": every choice asked for the same attention, so none of them stood out.
   * Now it's the list every phone settings screen uses (iOS Settings, WhatsApp,
   * Teams' own More), grouped in rounded cards: what you do (share, mini player,
   * full screen), where things are (Audio & video, Backgrounds & effects), what you
   * see (self view, videos first, save data), and the host's and your own
   * settings. Anything with more than one choice behind it is a row with a chevron
   * that opens a page INSIDE the sheet, with Back in the header, rather than a
   * dialog stacked on top, so you never lose your place or the call.
   *
   * Reactions left for the bar. Below 360px, where the bar can't fit them, a
   * reactions row stays at the top of this list instead.
   *
   * Same names as the desktop menu, so the two can't drift apart.
   */
  const reactionRow = (
    <div className="flex flex-wrap items-center justify-between gap-1" role="group" aria-label="Reactions">
      {REACTION_EMOJI.map((e) => (
        <IconButton
          key={e}
          label={`React ${e}`}
          icon={<span className="text-xl">{e}</span>}
          className="shrink-0 rounded-full"
          onClick={() => {
            sendReaction(e)
            closeMore()
          }}
        />
      ))}
      <IconButton
        label={handRaised ? 'Lower hand' : 'Raise hand'}
        icon={<HandIcon />}
        tone={handRaised ? 'accent' : 'neutral'}
        active={handRaised}
        className="rounded-full"
        onClick={() => {
          toggleHand()
          closeMore()
        }}
      />
    </div>
  )
  const { label: routeLabel } = useAudioRoute()
  const viewSwitch = (
    <div className="flex h-11 shrink-0 rounded-full bg-sunken p-1" role="group" aria-label="View layout">
      {(
        [
          { value: 'speaker', label: 'Speaker', icon: <SpeakerLayoutIcon /> },
          { value: 'grid', label: 'Gallery', icon: <GridIcon /> },
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
              'flex flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors [&_svg]:size-4',
              active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
  const moreMain = (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <div className="min-[360px]:hidden">{reactionRow}</div>
      {viewSwitch}
      <MoreGroup>
        {canScreenShare && (
          <MoreRow
            icon={<ScreenShareIcon />}
            label={shareSlotsFull ? 'Share screen (in use)' : 'Share screen'}
            kind="switch"
            on={screenShare.enabled}
            disabled={shareSlotsFull}
            onClick={() => screenShare.toggle()}
          />
        )}
        <MoreRow
          icon={<PipIcon />}
          label="Mini player"
          kind="switch"
          on={docPip.supported ? docPip.active : pipActive}
          onClick={() => {
            if (docPip.supported) docPip.toggle()
            else void togglePip()
            closeMore()
          }}
        />
        {canFullscreen && (
          <MoreRow
            icon={isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            label="Full screen"
            kind="switch"
            on={isFullscreen}
            onClick={() => {
              toggleFullscreen()
              closeMore()
            }}
          />
        )}
      </MoreGroup>
      <MoreGroup>
        <MoreRow
          icon={<SlidersIcon />}
          label="Audio & video"
          // Where sound is going, answered without opening anything: the thing
          // the old bar button was for.
          detail={routeLabel ?? undefined}
          kind="link"
          onClick={() => setMorePage('av', 'Audio & video')}
        />
        <MoreRow
          icon={<EffectsIcon />}
          label="Backgrounds & effects"
          detail={blur.mode === 'blur' ? 'Blur' : 'Off'}
          kind="link"
          onClick={() => setMorePage('effects', 'Backgrounds & effects')}
        />
      </MoreGroup>
      <MoreGroup>
        {/* Switches stay open on a tap, so you see the state flip. */}
        <MoreRow icon={<EyeIcon />} label="Self view" kind="switch" on={!selfViewHidden} onClick={toggleSelfView} />
        <MoreRow icon={<SortIcon />} label="Videos first" kind="switch" on={videosFirst} onClick={toggleVideosFirst} />
        <MoreRow
          icon={<CameraOffIcon />}
          label="Save data"
          name="Save data (pause incoming video)"
          detail="Pause incoming video"
          kind="switch"
          on={audioOnly}
          onClick={toggleAudioOnly}
        />
      </MoreGroup>
      <MoreGroup>
        {isHost && (
          <MoreRow icon={<LockIcon />} label="Host controls" kind="link" onClick={() => setMorePage('host', 'Host controls')} />
        )}
        <MoreRow icon={<SettingsIcon />} label="Settings" kind="link" onClick={() => setMorePage('settings', 'Settings')} />
      </MoreGroup>
    </div>
  )
  const moreHost = (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <MoreGroup>
        <MoreRow icon={<LockIcon />} label="Lock call" detail="No one new can join" kind="switch" on={locked} onClick={onToggleLock} />
        <MoreRow
          icon={<WaitingRoomIcon />}
          label="Waiting room"
          detail="You let people in"
          kind="switch"
          on={waiting}
          onClick={onToggleWaiting}
        />
        <MoreRow
          icon={<ChatIcon />}
          label="Chat history"
          detail="Late joiners see earlier messages"
          kind="switch"
          on={chatHistory}
          onClick={onToggleChatHistory}
        />
      </MoreGroup>
      {/* The one thing here that can't be undone: its own group, red, and still
          through the confirm dialog. */}
      <MoreGroup>
        <MoreRow
          danger
          icon={<LeaveIcon />}
          label="End call for everyone"
          onClick={() => {
            setModal('endConfirm')
            closeMore()
          }}
        />
      </MoreGroup>
    </div>
  )
  const MORE_PAGES = {
    main: { title: 'More', body: moreMain },
    av: { title: 'Audio & video', body: <div className="px-0 pb-3"><AudioVideoPage noise={noise} /></div> },
    effects: { title: 'Backgrounds & effects', body: <div className="px-1 pb-3"><BackgroundEffects controls={blur} /></div> },
    settings: { title: 'Settings', body: <div className="px-3 pb-3"><SettingsContent /></div> },
    host: { title: 'Host controls', body: moreHost },
  } as const
  const morePageNow = MORE_PAGES[morePage]
  const moreTouch = morePageNow.body

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
                ? 'Microphone unavailable — try again'
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
                  ? 'Microphone unavailable, try again'
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
                          ? 'Microphone access is blocked — allow it from your browser’s address bar'
                          : 'Still no microphone — check that one is connected',
                        'danger',
                      )
                    }
                  })
                  return
                }
                toggleDevice('microphone', !isMicrophoneEnabled, () =>
                  localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled),
                )
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
          {!compact && (
            <DeviceCaret label="Audio options">
              <AudioDevicePanel noise={noise} />
            </DeviceCaret>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip content={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}>
            <IconButton
              label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
              icon={isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
              tone={isCameraEnabled ? 'neutral' : 'danger'}
              active={!isCameraEnabled}
              onClick={() => void toggleCamera()}
            />
          </Tooltip>
          {/* Desktop only — same inert-class trap as the audio caret above. */}
          {!compact && (
            <DeviceCaret label="Camera options">
              <CameraDevicePanel />
            </DeviceCaret>
          )}
        </div>

        {/* Reactions and raise hand — on the phone's bar, third, where the audio
            output button used to sit (speaker choice moved into More → Audio &
            video, where the rest of the device choices already were). A hand is
            the one thing people reach for mid-conversation, and two taps into More
            was too far for it. Meet and Teams on a phone keep it on the bar.

            Folded away below 360px, where six controls cannot fit: 5 x 44px plus
            gaps and padding is 268 of the 288 available at 320px, and adding a
            sixth makes 318. More keeps a reactions row for exactly that width. A
            <span> wrapper, because `hidden` on a component with its own base
            display class is inert (see the device carets above). */}
        {touch && (
          <span className="hidden min-[360px]:inline-flex">
            <ReactionButton onPick={sendReaction} handRaised={handRaised} onToggleHand={toggleHand} grid />
          </span>
        )}

        {/* Screen share — desktop (mouse) only; folded into More on touch. Hidden
            where getDisplayMedia is unavailable (iOS).

            Gated on `!touch` rather than the `hidden pointer-fine:inline-flex`
            class it used to carry: IconButton's own base `inline-flex` beat
            `hidden` in the cascade, so this stayed visible on touch and phones
            showed the control TWICE — here and in the More sheet. Rendering
            conditionally can't lose a specificity race. */}
        {canScreenShare && !compact && (
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
                  ? 'Stop sharing'
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
        {canAnnotate && !narrowBar && (
          <Tooltip content={annotateActive ? 'Stop annotating' : 'Annotate shared screen'}>
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
              label={unread > 0 && panel !== 'chat' ? `Open chat, ${unread} unread` : 'Open chat'}
              icon={<ChatIcon />}
              tone="neutral"
              active={panel === 'chat'}
              aria-expanded={panel === 'chat'}
              onClick={() => togglePanel('chat')}
            />
            {unread > 0 && panel !== 'chat' && (
              <span aria-hidden className="pointer-events-none absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-control bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        </Tooltip>

        {/* Reactions on a laptop. One button — it also carries raise-hand. On
            touch it sits third on the bar instead (above). */}
        {!narrowBar && !touch && (
          <ReactionButton onPick={sendReaction} handRaised={handRaised} onToggleHand={toggleHand} />
        )}

        {/* More — bottom sheet on mobile (thumb-reachable), popover on desktop.
            Both render the same body; see moreContent above. */}
        {touch ? (
          <>
            <IconButton
              ref={moreRef}
              label="More options"
              icon={<MoreIcon />}
              tone="neutral"
              active={moreOpen}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMore(true)}
            />
            <Sheet
              open={moreOpen}
              onOpenChange={setMore}
              side="bottom"
              flush
              // Sideways it's the same right-hand panel as chat (lib/chatCompanion),
              // with the reactions in its top row beside the X when they fit.
              dock={companion.mode === 'side' ? { width: companion.panelW } : undefined}
              title={morePageNow.title}
              headerContent={
                morePage === 'main' ? (
                  <span aria-hidden className="px-1 text-lg font-semibold">
                    More
                  </span>
                ) : (
                  // A page inside the sheet, not a dialog on top: Back returns to
                  // the list and the call stays where it was.
                  <span className="flex items-center gap-1">
                    <IconButton label="Back" icon={<ChevronLeftIcon />} className="rounded-full" onClick={() => setMorePage('main')} />
                    <span aria-hidden className="truncate text-lg font-semibold">
                      {morePageNow.title}
                    </span>
                  </span>
                )
              }
            >
              <div
                ref={moreBody}
                key={morePage}
                role={morePage === 'main' ? undefined : 'group'}
                aria-label={morePage === 'main' ? undefined : morePageNow.title}
                className="mn-pop min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar">
                {moreTouch}
              </div>
            </Sheet>
          </>
        ) : (
          <Popover
            open={moreOpen}
            onOpenChange={setMore}
            side="top"
            align="end"
            trigger={
              <IconButton ref={moreRef} label="More options" icon={<MoreIcon />} tone="neutral" active={moreOpen} />
            }
          >
            <div className="max-h-[min(70vh,32rem)] w-80 max-w-[85vw] overflow-y-auto p-2 no-scrollbar">
              {moreContent}
            </div>
          </Popover>
        )}

        {/* Opened from More rows that unmount as they open, so closing returns
            focus to the More button rather than to <body>. */}
        <ReturnFocusContext.Provider value={moreRef}>
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
          description="This disconnects everyone and can’t be undone. To just leave yourself, use Leave instead."
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
        </ReturnFocusContext.Provider>

        {/* No divider in the two-column rail: it would take a grid cell of its own. */}
        {!twoCol && <div className={cn(rail ? 'my-1 h-px w-7' : 'mx-1 h-7 w-px', 'bg-line')} aria-hidden />}

        {isHost && !compact ? (
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
      data-rail={rail || undefined}
      // A phone's chat has the bars step aside for the call beside it
      // (lib/chatCompanion). Faded is not gone: out of the tab order and the
      // accessibility tree too, or a screen reader walks into a bar under the panel.
      inert={companionOpen || undefined}
      className={cn(
        'pointer-events-none fixed z-30 flex',
        rail
          ? // Sideways: a column on the trailing edge, centred on it, clear of the
            // notch side's inset. Same 16px floor, same 60px thickness, turned.
            'inset-y-0 right-[max(1rem,env(safe-area-inset-right))] items-center py-2'
          : 'inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] justify-center px-4',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !chromeVisible && (rail ? 'translate-x-[150%] opacity-0' : 'translate-y-[150%] opacity-0'),
      )}
    >
      <Island
        ref={barRef}
        // A landmark, so "jump to Call controls" works from anywhere on the page.
        role="region"
        aria-label="Call controls"
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
          rail
            ? twoCol
              ? // Three rows, filled column by column: mic/camera/reactions, then
                // chat/More/Leave — Leave still lands in the bottom trailing corner.
                'grid grid-flow-col grid-rows-3 place-items-center gap-1.5 px-2 py-2'
              : 'flex max-h-full flex-col items-center gap-1.5 overflow-y-auto px-2 py-2 no-scrollbar'
            : 'flex items-center gap-1.5 px-3 py-2 sm:gap-2',
          // Only interactive while shown — otherwise the off-screen bar still
          // caught taps/focus.
          chromeVisible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        {barRow}
      </Island>
    </div>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['M', 'Mute / unmute microphone'],
  ['V', 'Turn camera on / off'],
  ['C', 'Show or hide chat'],
  ['P', 'Show or hide people'],
  ['F', 'Enter or exit full screen'],
  ['?', 'Show this help'],
]

/** Keyboard-shortcut legend (desktop). Opened from More or by pressing "?". */
function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Available on desktop while not typing. Turn them off in Settings.">
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
 * Inline reaction picker (the bar's Reactions button, laptop and phone). Emoji plus a raise/lower-hand toggle —
 * hand is just a sticky reaction, so it lives here rather than as its own bar
 * button. Active state reflects a raised hand so the bar shows the cue.
 */
function ReactionButton({
  onPick,
  handRaised,
  onToggleHand,
  grid = false,
}: {
  onPick: (emoji: string) => void
  handRaised: boolean
  onToggleHand: () => void
  /** Two rows of four on a phone: one row of eight is 380px, wider than the screen. */
  grid?: boolean
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
          // The raised hand is otherwise shown only by the fill colour.
          label={handRaised ? 'Reactions and raise hand, your hand is raised' : 'Reactions and raise hand'}
          icon={<ReactionIcon />}
          tone={handRaised ? 'accent' : 'neutral'}
          active={open || handRaised}
        />
      }
    >
      <div className={grid ? 'grid grid-cols-4 gap-1' : 'flex items-center gap-1'}>
        {REACTION_EMOJI.map((e) => (
          <IconButton
            key={e}
            label={`React ${e}`}
            icon={<span className="text-xl">{e}</span>}
            className={grid ? 'rounded-full' : undefined}
            onClick={() => {
              onPick(e)
              setOpen(false)
            }}
          />
        ))}
        {!grid && <span className="mx-0.5 h-7 w-px bg-line" aria-hidden />}
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
  return <ToggleRow label="Noise suppression" checked={controls.enabled} onChange={controls.setEnabled} />
}

function MenuRow({
  icon,
  label,
  onClick,
  active,
  pressed,
  danger,
  state,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  /** A toggle whose label doesn't change: announced as pressed, and marked with a
   *  check, so its state isn't carried by the text colour alone. */
  pressed?: boolean
  /** Destructive row (end the call for everyone) — tone matches the bar's control. */
  danger?: boolean
  /** An on/off switch: announced as pressed, and says On or Off at the row's end. */
  state?: boolean
}) {
  return (
    <button
      onClick={onClick}
      data-danger={danger}
      // 44px on a coarse pointer (audit F6). The More sheet is a touch-only surface
      // and these rows were ~36px — clear of WCAG 2.5.8's 24px, short of both
      // platform guidelines, and sitting next to 68px GridTiles.
      className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-left text-sm hover:bg-sunken pointer-coarse:min-h-11 [&_svg]:size-4 data-[active=true]:text-accent-text data-[danger=true]:text-danger-text"
      data-active={active}
      aria-pressed={state ?? pressed}
    >
      {icon}
      {label}
      {pressed && <CheckIcon className="ml-auto" aria-hidden />}
      {state !== undefined && (
        <span aria-hidden className={cn('ml-auto text-xs font-medium', state ? 'text-accent-text' : 'text-ink-subtle')}>
          {state ? 'On' : 'Off'}
        </span>
      )}
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
 * More → Audio & video on a phone: every device choice, as flat lists.
 *
 * One level, nothing nests. Every mobile path to a device used to be a picker
 * inside a picker: a popover holding select-style rows that each opened another
 * popover, `side="top"` on both, no max-height and no scroll container. Radix
 * flips a panel that doesn't fit, so on a short phone the inner one resolved
 * DOWNWARD off a control 40px from the bottom of the screen. A page of rows can't.
 *
 * Output first, because that's the decision a phone user is making ("put it on
 * the headset"). It used to have its own button on the bar; that slot went to
 * reactions, and the route's name now shows on the row that leads here. Absent
 * where the platform can't route (iOS Safari) rather than shown empty.
 */
function AudioVideoPage({ noise }: { noise: NoiseFilterControls }) {
  const { canRoute } = useAudioRoute()
  return (
    <div className="flex flex-col">
      {canRoute && <DeviceRouteList kind="audiooutput" heading="Play sound through" />}
      <DeviceRouteList kind="audioinput" heading="Microphone" />
      <DeviceRouteList kind="videoinput" heading="Camera" />
      <div className="border-t border-line">
        <ToggleRow
          label="Noise suppression"
          hint="Filters keyboards and traffic"
          checked={noise.enabled}
          onChange={noise.setEnabled}
          touch
        />
        <BluetoothToggle touch />
      </div>
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
  const switchTo = useSwitchDevice(kind, heading, setActiveMediaDevice)
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
                onClick={() => switchTo(d)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 text-left [&_svg]:size-5 [&_svg]:shrink-0',
                  active ? 'text-accent-text' : 'text-ink hover:bg-sunken',
                  TOUCH_ROW,
                )}
              >
                {kind === 'videoinput' ? <CameraIcon /> : kind === 'audioinput' ? <MicIcon /> : <SoundOnIcon />}
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

/**
 * One settings switch as a full-width row. There were three copies of this (the
 * menu's noise and Bluetooth rows and the touch tray's) that differed only in
 * padding; `touch` is the thumb-sized one from the audio tray.
 */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  touch = false,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  touch?: boolean
}) {
  return (
    <div className={touch ? cn('flex items-center gap-3 px-3', TOUCH_ROW) : 'px-2.5 py-1.5'}>
      <Toggle checked={checked} onCheckedChange={onChange} label={label} hint={hint} className="w-full justify-between" />
    </div>
  )
}

/** "Auto-connect Bluetooth" preference — when on, a headset that connects takes over
 *  audio automatically (useAudioDeviceAutoswitch). */
function BluetoothToggle({ touch = false }: { touch?: boolean }) {
  const autoBluetooth = useDeviceStore((s) => s.autoBluetooth)
  const setAutoBluetooth = useDeviceStore((s) => s.setAutoBluetooth)
  return (
    <ToggleRow
      label="Auto-connect Bluetooth"
      hint={touch ? 'Take over when a headset connects' : undefined}
      checked={autoBluetooth}
      onChange={setAutoBluetooth}
      touch={touch}
    />
  )
}

/** One rounded card of rows in the phone's More list (iOS inset-grouped style). */
function MoreGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[18px] bg-sunken [&>*+*]:border-t [&>*+*]:border-line">
      {children}
    </div>
  )
}

/**
 * One row of the phone's More list. `kind` says what a tap does and the row's end
 * says it back: a switch shows a toggle, a link shows a chevron (and opens a page
 * in the sheet), an action shows nothing. `detail` is the quiet second word on the
 * right (where sound goes, whether blur is on) or, for a switch, a line under the
 * label. `name` is for the few whose short label needs its longer, established
 * name for assistive tech; it always begins with the visible label.
 */
function MoreRow({
  icon,
  label,
  name,
  detail,
  kind = 'action',
  on,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode
  label: string
  name?: string
  detail?: string
  kind?: 'action' | 'switch' | 'link'
  on?: boolean
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      data-more-row={label}
      aria-pressed={kind === 'switch' ? Boolean(on) : undefined}
      data-danger={danger || undefined}
      className={cn(
        'flex min-h-[3.25rem] w-full items-center gap-3 px-3.5 py-2 text-left text-[15px] transition-colors',
        '[&>svg]:size-5 [&>svg]:shrink-0',
        danger ? 'font-semibold text-danger-text active:bg-danger/10' : 'text-ink active:bg-line [&>svg]:text-ink-muted',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail && kind === 'switch' && <span className="truncate text-xs text-ink-muted">{detail}</span>}
      </span>
      {detail && kind === 'link' && <span className="max-w-[40%] truncate text-sm text-ink-muted">{detail}</span>}
      {kind === 'switch' && (
        <span
          aria-hidden
          className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-line-strong')}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left]',
              on ? 'left-[1.125rem]' : 'left-0.5',
            )}
          />
        </span>
      )}
      {kind === 'link' && <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />}
    </button>
  )
}

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
      <span className={cn('text-center text-[11px] leading-tight', active ? 'text-accent-text' : 'text-ink-muted')}>
        {label}
      </span>
    </button>
  )
}

