import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocalParticipant, useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { annotateEnabled } from '@/features/annotate/useAnnotate'
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
} from '@/components/icons'
import { DeviceSettings, DeviceRow } from '@/islands/DeviceMenu'
import { EffectsDialog } from '@/islands/BackgroundEffects'
import { SettingsDialog } from '@/islands/Settings'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import type { NoiseFilterControls } from '@/features/effects/useNoiseFilter'
import { useRoomStore, type GridSize } from '@/store/useRoomStore'
import { useDeviceStore } from '@/store/useDeviceStore'
import { useCameraToggle } from '@/lib/useCameraToggle'
import { useIsTouch } from '@/lib/useIsTouch'
import { useFullscreen } from '@/lib/useFullscreen'
import { cn } from '@/lib/cn'

export interface ControlBarProps {
  /** When false (mobile auto-hide), the bar slides out of the thumb zone. */
  chromeVisible: boolean
  /** Pin/unpin the auto-hiding chrome — held open while a menu is showing. */
  onMenuOpenChange?: (open: boolean) => void
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
 * self-view tile; layout switching lives in More / the top chip. STYLE.md §4/§5.
 */
export function ControlBar({
  chromeVisible,
  onMenuOpenChange,
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
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant()
  // Annotation only makes sense while there's a shared screen to draw on.
  const shareTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  const someoneSharing = shareTracks.length > 0
  const annotateActive = useAnnotateStore((s) => s.active)
  const annotateAllowed = useAnnotateStore((s) => s.allowed)
  const toggleAnnotate = useAnnotateStore((s) => s.toggle)
  const setAnnotateActive = useAnnotateStore((s) => s.setActive)
  // Disarm when the last share ends. The button disappears with it, so a pen left
  // armed is unreachable — and it would silently re-arm itself the moment the next
  // person shared. It also matters for the presenter's own share, where being armed
  // is what pulls that share into their stage.
  useEffect(() => {
    if (!someoneSharing) setAnnotateActive(false)
  }, [someoneSharing, setAnnotateActive])
  // Camera toggle goes through the warm-then-release path (fast re-enable).
  const { isCameraEnabled, toggleCamera } = useCameraToggle()
  const [pipActive, setPipActive] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [effectsOpen, setEffectsOpen] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const touch = useIsTouch()
  const { isFullscreen, toggleFullscreen } = useFullscreen()
  // Screen share needs getDisplayMedia — absent on iOS Safari (and iOS Chrome,
  // which is WebKit underneath). Hide the control there instead of offering a
  // button that silently fails.
  const canScreenShare =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)

  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const unread = useRoomStore((s) => s.unread)
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const gridSize = useRoomStore((s) => s.gridSize)
  const setGridSize = useRoomStore((s) => s.setGridSize)
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
          toast("Picture-in-Picture isn't available here", 'warning')
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

      toast("Picture-in-Picture isn't available here", 'warning')
    } catch {
      toast("Couldn't open Picture-in-Picture", 'warning')
    }
  }, [])

  // Legible gallery-size steps differ by device: phones top out at 9 (2-wide),
  // desktop at 16. 'Auto' = fit-to-viewport (the default).
  const gallerySizes: { value: GridSize; label: string }[] = touch
    ? [{ value: 'auto', label: 'Auto' }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 9, label: '9' }]
    : [{ value: 'auto', label: 'Auto' }, { value: 4, label: '4' }, { value: 9, label: '9' }, { value: 16, label: '16' }]

  const togglePanel = (tab: 'chat' | 'people') => setPanel(panel === tab ? null : tab)

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
          setShortcutsOpen(true)
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
        {canScreenShare && (
          <GridTile
            className="pointer-fine:hidden"
            icon={<ScreenShareIcon />}
            label="Share screen"
            active={isScreenShareEnabled}
            onClick={() => {
              localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
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
        <GridTile
          icon={isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          label="Full screen"
          active={isFullscreen}
          onClick={() => {
            toggleFullscreen()
            closeMore()
          }}
        />
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

      {/* View — layout + density in ONE control (was two separate sections: a
          Grid/Speaker pair up top and a "Gallery size" row). Speaker = one large feed
          + filmstrip; Grid = gallery. Only the grid is paged, so the size chips appear
          only when Grid is active — 'Auto' fits the viewport, a number caps the page. */}
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
                  active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink hover:bg-line',
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            )
          })}
        </div>
        {layout === 'grid' && (
          <div className="mt-1.5 flex gap-1" role="group" aria-label="Gallery size — tiles per page">
            {gallerySizes.map((opt) => {
              const active = gridSize === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setGridSize(opt.value)
                    if (opt.value !== 'auto') setLayout('grid')
                  }}
                  className={cn(
                    'flex-1 rounded-control py-1.5 text-sm font-medium transition-colors',
                    active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink hover:bg-line',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* A short action list (Google model) — heavy controls live in dialogs, so
          the menu never needs to scroll. */}
      <div className="mt-1 flex flex-col border-t border-line pt-1">
        <MenuRow
          icon={<EffectsIcon />}
          label="Backgrounds & effects"
          onClick={() => {
            setEffectsOpen(true)
            closeMore()
          }}
        />
        <MenuRow
          icon={<SlidersIcon />}
          label="Audio & video"
          onClick={() => {
            setDevicesOpen(true)
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
        <MenuRow
          icon={<SettingsIcon />}
          label="Settings"
          onClick={() => {
            setSettingsOpen(true)
            closeMore()
          }}
        />
        {/* Keyboard shortcuts — desktop (mouse) only. */}
        <div className="hidden pointer-fine:block">
          <MenuRow
            icon={<KeyboardIcon />}
            label="Keyboard shortcuts"
            onClick={() => {
              setShortcutsOpen(true)
              closeMore()
            }}
          />
        </div>
      </div>
    </div>
  )

  return (
    // bottom inset clears the iOS home indicator (viewport-fit=cover is set).
    // Slides out of the thumb zone when chrome is hidden (mobile tap-to-hide).
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4',
        'transition-[transform,opacity,padding] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        // Reflow left of the docked side panel on desktop — same inset the stage
        // uses (RoomView) — so the bar centres in the visible area instead of
        // sliding under the chat/people panel.
        panel && 'md:pr-[20rem] lg:pr-[22rem] xl:pr-[25rem]',
        !chromeVisible && 'translate-y-[150%] opacity-0',
      )}
    >
      <Island
        pad="none"
        elevation="raised"
        className={cn(
          'flex items-center gap-1.5 rounded-control px-3 py-2 sm:gap-2',
          // Only interactive while shown — otherwise the off-screen bar still
          // caught taps/focus.
          chromeVisible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        {locked && (
          <Tooltip content="Room is locked">
            <span
              className="grid size-9 place-items-center rounded-control bg-accent-soft text-accent [&_svg]:size-4"
              role="img"
              aria-label="Room is locked"
            >
              <LockIcon />
            </span>
          </Tooltip>
        )}

        {/* Mic — toggle + a caret (desktop) that opens the audio device picker right
            at the button (Meet/Zoom/Teams pattern), so device controls are never
            hidden in a menu. Touch reaches the same picker via the Output button and
            "Audio & video" in More. */}
        <div className="flex items-center gap-0.5">
          <Tooltip content={isMicrophoneEnabled ? 'Mute' : 'Unmute'}>
            <IconButton
              label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
              icon={isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
              tone={isMicrophoneEnabled ? 'neutral' : 'danger'}
              active={!isMicrophoneEnabled}
              onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            />
          </Tooltip>
          <DeviceCaret label="Audio options" className="hidden pointer-fine:inline-flex">
            <AudioDevicePanel noise={noise} />
          </DeviceCaret>
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
          <DeviceCaret label="Camera options" className="hidden pointer-fine:inline-flex">
            <CameraDevicePanel />
          </DeviceCaret>
        </div>

        {/* Audio output — always visible (Brave/Skype/WhatsApp pattern). One tap to
            see and switch which speaker/headset audio plays through, the control
            users hunt for most on mobile. */}
        <OutputDeviceButton noise={noise} />

        {/* Screen share — desktop (mouse) only; folded into More on touch. Hidden
            where getDisplayMedia is unavailable (iOS).

            Gated on `!touch` rather than the `hidden pointer-fine:inline-flex`
            class it used to carry: IconButton's own base `inline-flex` beat
            `hidden` in the cascade, so this stayed visible on touch and phones
            showed the control TWICE — here and in the More sheet. Rendering
            conditionally can't lose a specificity race. */}
        {canScreenShare && !touch && (
          <Tooltip content={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
            <IconButton
              label={isScreenShareEnabled ? 'Stop screen share' : 'Share screen'}
              icon={<ScreenShareIcon />}
              tone="neutral"
              active={isScreenShareEnabled}
              onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
            />
          </Tooltip>
        )}

        {/* Annotate — only while someone is actually sharing, and desktop only:
            drawing has to capture touch, which would fight the control bar's
            tap-to-reveal. Touch devices still SEE everyone's strokes. */}
        {annotateEnabled && someoneSharing && annotateAllowed && !touch && (
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

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <EffectsDialog open={effectsOpen} onOpenChange={setEffectsOpen} controls={blur} />
        <Dialog
          open={devicesOpen}
          onOpenChange={setDevicesOpen}
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
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <Dialog
          open={endConfirmOpen}
          onOpenChange={setEndConfirmOpen}
          title="End the call for everyone?"
          description="This disconnects all participants and can't be undone. To just leave yourself, use Leave instead."
        >
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setEndConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setEndConfirmOpen(false)
                onEndForEveryone()
              }}
            >
              <LeaveIcon />
              End for everyone
            </Button>
          </div>
        </Dialog>

        <div className="mx-1 h-7 w-px bg-line" aria-hidden />

        {isHost ? (
          // Split control: leaving (call continues) is the primary action; ending
          // for everyone is tucked behind the caret. Styled as one danger pill.
          <div className="flex h-11 items-stretch overflow-hidden rounded-control">
            <Tooltip content="Leave — the call continues">
              <button
                type="button"
                onClick={onLeave}
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
              <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={() => setEndConfirmOpen(true)}>
                End call for everyone
              </DropdownItem>
            </DropdownMenu>
          </div>
        ) : (
          <Tooltip content="Leave">
            <IconButton label="Leave call" icon={<LeaveIcon />} tone="danger" onClick={onLeave} />
          </Tooltip>
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
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken [&_svg]:size-4 data-[active=true]:text-accent"
      data-active={active}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * Small caret button that opens a device picker anchored to a bar control (the
 * mic/camera "split button" chevron). Desktop-only via the caller's className —
 * touch uses the Output button + More, where a full-size tap target is friendlier.
 */
function DeviceCaret({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
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
          label={label}
          size="sm"
          tone="neutral"
          active={open}
          icon={<ChevronUpIcon />}
          className={className}
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
      <DeviceRow kind="audiooutput" label="Audio output" />
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

/** Always-visible audio-output control (Brave/Skype/WhatsApp). Shows the speaker
 *  list plus the Bluetooth-auto toggle — the routing users most want at a tap. */
function OutputDeviceButton({ noise }: { noise: NoiseFilterControls }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="center"
      trigger={
        <Tooltip content="Audio output">
          <IconButton label="Audio output" tone="neutral" active={open} icon={<SoundOnIcon />} />
        </Tooltip>
      }
    >
      <div className="w-72 max-w-[85vw]">
        <AudioDevicePanel noise={noise} />
      </div>
    </Popover>
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
  onClick,
  className,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex flex-col items-center gap-1 rounded-field px-1 py-2 hover:bg-sunken', className)}
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

