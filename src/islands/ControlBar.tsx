import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import {
  DropdownMenu,
  DropdownItem,
  Island,
  IconButton,
  Popover,
  Toggle,
  Tooltip,
} from '@/components/primitives'
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  ChevronUpIcon,
  FullscreenIcon,
  GridIcon,
  HandIcon,
  LeaveIcon,
  LockIcon,
  FlipCameraIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  PeopleIcon,
  PipIcon,
  ReactionIcon,
  ScreenShareIcon,
  SettingsIcon,
  SpeakerLayoutIcon,
  SpotlightIcon,
} from '@/components/icons'
import { LayoutSwitcher } from '@/islands/LayoutSwitcher'
import { DeviceMenu } from '@/islands/DeviceMenu'
import { BackgroundEffects } from '@/islands/BackgroundEffects'
import { SettingsDialog } from '@/islands/Settings'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import type { NoiseFilterControls } from '@/features/effects/useNoiseFilter'
import { useRoomStore } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

export interface ControlBarProps {
  /** When false (mobile auto-hide), the bar slides out of the thumb zone. */
  chromeVisible: boolean
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
 * Tier-0 controls always visible (mic, camera, leave). Tier-1 (chat, people,
 * reactions, hand, layout, share) inline on desktop, folded into More on mobile.
 * Tier-2 (devices, theme) lives in More. STYLE.md §4/§5.
 */
export function ControlBar({
  chromeVisible,
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
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const [pipActive, setPipActive] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { isFullscreen, toggleFullscreen } = useFullscreen()

  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const unread = useRoomStore((s) => s.unread)
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)

  useEffect(() => {
    const onLeavePip = () => setPipActive(false)
    document.addEventListener('leavepictureinpicture', onLeavePip)
    return () => document.removeEventListener('leavepictureinpicture', onLeavePip)
  }, [])

  const togglePip = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setPipActive(false)
        return
      }
      // The local self-view is CSS-mirrored, but PiP shows raw (unmirrored)
      // frames, so PiP-ing yourself looks flipped. Prefer a remote video —
      // detected as one with no mirror transform — that's actually playing.
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
      const playing = videos.filter((v) => v.videoWidth > 0)
      const target =
        playing.find((v) => getComputedStyle(v).transform === 'none') ?? playing[0] ?? videos[0]
      if (target && document.pictureInPictureEnabled) {
        await target.requestPictureInPicture()
        setPipActive(true)
      }
    } catch {
      /* user gesture / unsupported — ignore */
    }
  }, [])

  const togglePanel = (tab: 'chat' | 'people') => setPanel(panel === tab ? null : tab)

  // Mobile front/rear flip — restart the camera track with the opposite facing
  // mode. (Desktops use the device picker in More → Devices instead.)
  const flipCamera = useCallback(async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      | LocalVideoTrack
      | undefined
    if (!track) return
    const facing = track.mediaStreamTrack.getSettings().facingMode
    const next = facing === 'environment' ? 'user' : 'environment'
    try {
      await track.restartTrack({ facingMode: next })
    } catch {
      /* device can't switch facing — ignore */
    }
  }, [localParticipant])

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
        pad="none"
        elevation="raised"
        className="pointer-events-auto flex items-center gap-1.5 rounded-control px-3 py-2 sm:gap-2"
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

        <Tooltip content={isMicrophoneEnabled ? 'Mute' : 'Unmute'}>
          <IconButton
            label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            icon={isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            tone={isMicrophoneEnabled ? 'neutral' : 'danger'}
            active={!isMicrophoneEnabled}
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          />
        </Tooltip>

        <Tooltip content={isCameraEnabled ? 'Stop video' : 'Start video'}>
          <IconButton
            label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            icon={isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
            tone={isCameraEnabled ? 'neutral' : 'danger'}
            active={!isCameraEnabled}
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
          />
        </Tooltip>

        {/* Flip front/rear — touch devices only, and only while the camera is on. */}
        {isCameraEnabled && (
          <Tooltip content="Flip camera">
            <IconButton
              label="Flip camera"
              icon={<FlipCameraIcon />}
              tone="neutral"
              className="pointer-fine:hidden"
              onClick={() => void flipCamera()}
            />
          </Tooltip>
        )}

        {/* Screen share — desktop (mouse) only; folded into More on touch. */}
        <Tooltip content={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
          <IconButton
            label={isScreenShareEnabled ? 'Stop screen share' : 'Share screen'}
            icon={<ScreenShareIcon />}
            tone="neutral"
            active={isScreenShareEnabled}
            className="hidden pointer-fine:inline-flex"
            onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
          />
        </Tooltip>

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

        {/* Desktop-inline Tier-1 group (mouse only; folded into More on touch). */}
        <Tooltip content="Participants">
          <IconButton
            label="Show participants"
            icon={<PeopleIcon />}
            tone="neutral"
            active={panel === 'people'}
            className="hidden pointer-fine:inline-flex"
            onClick={() => togglePanel('people')}
          />
        </Tooltip>

        <span className="hidden pointer-fine:inline-flex">
          <ReactionButton onPick={sendReaction} />
        </span>

        <Tooltip content={handRaised ? 'Lower hand' : 'Raise hand'}>
          <IconButton
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            icon={<HandIcon />}
            tone={handRaised ? 'accent' : 'neutral'}
            active={handRaised}
            className="hidden pointer-fine:inline-flex"
            onClick={toggleHand}
          />
        </Tooltip>

        <span className="hidden pointer-fine:inline-flex">
          <LayoutSwitcher />
        </span>

        {/* More — window controls (PiP, full screen), effects, devices,
            appearance, host controls; plus the Tier-1 overflow on mobile. */}
        <Popover
          side="top"
          align="end"
          trigger={<IconButton label="More options" icon={<MoreIcon />} tone="neutral" />}
        >
          <div className="max-h-[min(70vh,32rem)] w-72 max-w-[80vw] overflow-y-auto p-1">
            {/* View — overflow of the inline group (each item shown here only at
                the width where it leaves the bar, so nothing duplicates) +
                window controls for everyone. */}
            <Section label="View">
              {/* Screen share leaves the bar on touch devices. */}
              <div className="pointer-fine:hidden">
                <MenuRow
                  icon={<ScreenShareIcon />}
                  label={isScreenShareEnabled ? 'Stop screen share' : 'Share screen'}
                  onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
                  active={isScreenShareEnabled}
                />
              </div>
              {/* Participants / hand / layout leave the bar on touch devices. */}
              <div className="pointer-fine:hidden">
                <MenuRow
                  icon={<PeopleIcon />}
                  label="Participants"
                  onClick={() => togglePanel('people')}
                  active={panel === 'people'}
                />
                <MenuRow
                  icon={<HandIcon />}
                  label={handRaised ? 'Lower hand' : 'Raise hand'}
                  onClick={toggleHand}
                  active={handRaised}
                />
                <MenuRow
                  icon={<GridIcon />}
                  label="Grid"
                  onClick={() => setLayout('grid')}
                  active={layout === 'grid'}
                />
                <MenuRow
                  icon={<SpeakerLayoutIcon />}
                  label="Speaker"
                  onClick={() => setLayout('speaker')}
                  active={layout === 'speaker'}
                />
                <MenuRow
                  icon={<SpotlightIcon />}
                  label="Spotlight"
                  onClick={() => setLayout('spotlight')}
                  active={layout === 'spotlight'}
                />
              </div>
              <MenuRow
                icon={<PipIcon />}
                label="Picture-in-picture"
                onClick={() => (docPip.supported ? docPip.toggle() : togglePip())}
                active={docPip.supported ? docPip.active : pipActive}
              />
              <MenuRow
                icon={<FullscreenIcon />}
                label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                onClick={toggleFullscreen}
                active={isFullscreen}
              />
              {/* Reactions leave the bar on touch devices. */}
              <div className="pointer-fine:hidden">
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-ink-subtle">React</div>
                <div className="flex justify-between px-1 pb-1">
                  {REACTION_EMOJI.map((e) => (
                    <IconButton key={e} size="sm" label={`React ${e}`} icon={<span className="text-lg">{e}</span>} onClick={() => sendReaction(e)} />
                  ))}
                </div>
              </div>
            </Section>

            {isHost && (
              <Section label="Host controls">
                <MenuRow
                  icon={<LockIcon />}
                  label={locked ? 'Unlock room' : 'Lock room'}
                  onClick={onToggleLock}
                  active={locked}
                />
                <MenuRow
                  icon={<PeopleIcon />}
                  label={waiting ? 'Waiting room: on' : 'Waiting room: off'}
                  onClick={onToggleWaiting}
                  active={waiting}
                />
              </Section>
            )}

            <Section label="Effects">
              <BackgroundEffects controls={blur} />
            </Section>

            <Section label="Audio">
              <NoiseSuppression controls={noise} />
            </Section>

            <Section label="Devices">
              <DeviceMenu
                trigger={
                  <button className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken [&_svg]:size-4">
                    <SettingsIcon />
                    Devices
                  </button>
                }
              />
            </Section>

            <Section label="Preferences" last>
              <MenuRow
                icon={<SettingsIcon />}
                label="Settings"
                onClick={() => setSettingsOpen(true)}
              />
            </Section>
          </div>
        </Popover>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

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
              <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={onEndForEveryone}>
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

/** Inline reaction picker (desktop). Opens a small emoji grid. */
function ReactionButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="center"
      trigger={<IconButton label="Send a reaction" icon={<ReactionIcon />} tone="neutral" active={open} />}
    >
      <div className="flex gap-1">
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
      </div>
    </Popover>
  )
}

/** Tier-2 audio: AI background-noise suppression toggle (Krisp). */
function NoiseSuppression({ controls }: { controls: NoiseFilterControls }) {
  const { supported, enabled, setEnabled } = controls
  if (!supported) {
    return (
      <p className="px-2.5 py-2 text-xs text-ink-subtle">
        Noise suppression isn't supported on this browser.
      </p>
    )
  }
  return (
    <div className="px-2.5 py-1.5">
      <Toggle
        checked={enabled}
        onCheckedChange={setEnabled}
        label="Noise suppression"
        className="w-full justify-between"
      />
      <p className="mt-1 text-xs text-ink-subtle">
        Strips keyboard, fans, and background voices the mic picks up.
      </p>
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

/** Labeled group inside the More menu — a hairline-separated section header. */
function Section({ label, last, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cn(!last && 'mb-1 border-b border-line pb-1')}>
      <p className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-ink-subtle">{label}</p>
      {children}
    </div>
  )
}

/** Document-level fullscreen toggle + live state. */
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  )
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen().catch(() => {})
  }, [])
  return { isFullscreen, toggleFullscreen }
}
