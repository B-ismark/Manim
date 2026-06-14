import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownItem,
  Island,
  IconButton,
  Popover,
  Tooltip,
} from '@/components/primitives'
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  HandIcon,
  LeaveIcon,
  LockIcon,
  MergeIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  PeopleIcon,
  PipIcon,
  ReactionIcon,
  ScreenShareIcon,
  SettingsIcon,
} from '@/components/icons'
import { ThemeSwitcher } from '@/islands/ThemeSwitcher'
import { LayoutSwitcher } from '@/islands/LayoutSwitcher'
import { DeviceMenu } from '@/islands/DeviceMenu'
import { BackgroundEffects } from '@/islands/BackgroundEffects'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import { useRoomStore } from '@/store/useRoomStore'

export interface ControlBarProps {
  /** Leave the call yourself (call continues for others). */
  onLeave: () => void
  /** Host-only: end the call for everyone. */
  onEndForEveryone: () => void
  /** Host-only: move everyone into another room. */
  onMerge: (room: string) => void
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
}

/**
 * Tier-0 controls always visible (mic, camera, leave). Tier-1 (chat, people,
 * reactions, hand, layout, share) inline on desktop, folded into More on mobile.
 * Tier-2 (devices, theme) lives in More. STYLE.md §4/§5.
 */
export function ControlBar({
  onLeave,
  onEndForEveryone,
  onMerge,
  isHost,
  locked,
  onToggleLock,
  waiting,
  onToggleWaiting,
  sendReaction,
  handRaised,
  toggleHand,
  blur,
}: ControlBarProps) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const [pipActive, setPipActive] = useState(false)

  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const unread = useRoomStore((s) => s.unread)

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

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
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

        {/* Screen share — hidden on the narrowest screens, available in More. */}
        <Tooltip content={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
          <IconButton
            label={isScreenShareEnabled ? 'Stop screen share' : 'Share screen'}
            icon={<ScreenShareIcon />}
            tone="neutral"
            active={isScreenShareEnabled}
            className="hidden sm:inline-flex"
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

        {/* Desktop-inline Tier-1 group. */}
        <Tooltip content="Participants">
          <IconButton
            label="Show participants"
            icon={<PeopleIcon />}
            tone="neutral"
            active={panel === 'people'}
            className="hidden md:inline-flex"
            onClick={() => togglePanel('people')}
          />
        </Tooltip>

        <span className="hidden md:inline-flex">
          <ReactionButton onPick={sendReaction} />
        </span>

        <Tooltip content={handRaised ? 'Lower hand' : 'Raise hand'}>
          <IconButton
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            icon={<HandIcon />}
            tone={handRaised ? 'accent' : 'neutral'}
            active={handRaised}
            className="hidden md:inline-flex"
            onClick={toggleHand}
          />
        </Tooltip>

        <span className="hidden md:inline-flex">
          <LayoutSwitcher />
        </span>

        <Tooltip content="Picture-in-picture">
          <IconButton
            label="Picture-in-picture"
            icon={<PipIcon />}
            tone="neutral"
            active={pipActive}
            className="hidden md:inline-flex"
            onClick={togglePip}
          />
        </Tooltip>

        {/* More — overflow on mobile + Tier-2 (devices, theme) everywhere. */}
        <Popover
          side="top"
          align="end"
          trigger={<IconButton label="More options" icon={<MoreIcon />} tone="neutral" />}
        >
          <div className="w-72 max-w-[80vw] p-1">
            {/* Mobile-only overflow of the inline Tier-1 group. */}
            <div className="md:hidden">
              <MenuRow
                icon={<ScreenShareIcon />}
                label={isScreenShareEnabled ? 'Stop screen share' : 'Share screen'}
                onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
                active={isScreenShareEnabled}
              />
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
              <MenuRow icon={<PipIcon />} label="Picture-in-picture" onClick={togglePip} active={pipActive} />
              <div className="px-2 pb-1 pt-2 text-xs font-medium text-ink-subtle">React</div>
              <div className="flex justify-between px-1 pb-1">
                {REACTION_EMOJI.map((e) => (
                  <IconButton key={e} size="sm" label={`React ${e}`} icon={<span className="text-lg">{e}</span>} onClick={() => sendReaction(e)} />
                ))}
              </div>
              <Divider />
            </div>

            {isHost && (
              <>
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
                <MergeControl onMerge={onMerge} />
                <Divider />
              </>
            )}

            <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-ink-subtle">Background</div>
            <BackgroundEffects controls={blur} />
            <Divider />

            <DeviceMenu
              trigger={
                <button className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken [&_svg]:size-4">
                  <SettingsIcon />
                  Devices
                </button>
              }
            />
            <Divider />
            <ThemeSwitcher />
          </div>
        </Popover>

        <div className="mx-1 h-7 w-px bg-line" aria-hidden />

        {isHost ? (
          <DropdownMenu
            side="top"
            align="end"
            trigger={<IconButton label="Leave or end call" icon={<LeaveIcon />} tone="danger" />}
          >
            <DropdownItem onSelect={onLeave}>Leave (call continues)</DropdownItem>
            <DropdownItem tone="danger" icon={<LeaveIcon />} onSelect={onEndForEveryone}>
              End call for everyone
            </DropdownItem>
          </DropdownMenu>
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

/** Host-only: merge everyone into another room. Opens a Dialog for the target code. */
function MergeControl({ onMerge }: { onMerge: (room: string) => void }) {
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!room.trim()) return
    onMerge(room)
    setOpen(false)
    setRoom('')
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken [&_svg]:size-4"
      >
        <MergeIcon />
        Merge with another call
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Merge calls"
        description="Move everyone in this call into another room."
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Target room code"
            aria-label="Target room code"
            autoComplete="off"
            className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button type="submit" variant="accent" disabled={!room.trim()}>
            Merge everyone
          </Button>
        </form>
      </Dialog>
    </>
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

function Divider() {
  return <div className="my-1 h-px bg-line" aria-hidden />
}
