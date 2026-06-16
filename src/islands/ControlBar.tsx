import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
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
  GridIcon,
  HandIcon,
  LeaveIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  MoreIcon,
  PeopleIcon,
  PipIcon,
  ReactionIcon,
  ScreenShareIcon,
  SettingsIcon,
  SpeakerLayoutIcon,
  EffectsIcon,
  KeyboardIcon,
} from '@/components/icons'
import { DeviceSettings } from '@/islands/DeviceMenu'
import { EffectsDialog } from '@/islands/BackgroundEffects'
import { SettingsDialog } from '@/islands/Settings'
import { REACTION_EMOJI } from '@/features/reactions/useReactions'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import type { NoiseFilterControls } from '@/features/effects/useNoiseFilter'
import { useRoomStore } from '@/store/useRoomStore'
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
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const [pipActive, setPipActive] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [effectsOpen, setEffectsOpen] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const touch = useIsTouch()
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
      switch (e.key.toLowerCase()) {
        case 'm':
          void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
          break
        case 'v':
          void localParticipant.setCameraEnabled(!isCameraEnabled)
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
  }, [touch, localParticipant, isMicrophoneEnabled, isCameraEnabled, toggleFullscreen, setPanel, panel])

  // Shared "More" body — rendered in a bottom sheet on mobile, a popover on
  // desktop. A reaction strip headlines the sheet; quick toggles fill a grid;
  // rich controls (effects/audio/devices) follow as labeled sections. Items
  // that live on the inline bar at wider widths hide here at the matching
  // breakpoint, so nothing duplicates.
  const moreContent = (
    <div className="flex flex-col">
      <div className="mb-2 pointer-fine:hidden">
        <p className="px-1 pb-1 text-xs font-medium text-ink-subtle">React</p>
        <div className="flex items-center justify-between gap-1">
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
        <GridTile
          className="pointer-fine:hidden"
          icon={<ScreenShareIcon />}
          label={isScreenShareEnabled ? 'Stop share' : 'Share'}
          active={isScreenShareEnabled}
          onClick={() => {
            localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
            closeMore()
          }}
        />
        {/* People lives in the top-right StageTopBar, not here. Layout switching
            lives here on every device now (the inline desktop switcher is gone). */}
        <GridTile
          icon={<GridIcon />}
          label="Grid"
          active={layout === 'grid'}
          onClick={() => {
            setLayout('grid')
            closeMore()
          }}
        />
        <GridTile
          icon={<SpeakerLayoutIcon />}
          label="Speaker"
          active={layout === 'speaker'}
          onClick={() => {
            setLayout('speaker')
            closeMore()
          }}
        />
        {/* PiP — desktop only. On mobile auto-PiP floats the call when the app is
            backgrounded, so a manual tile would be redundant. */}
        {!touch && (
          <GridTile
            icon={<PipIcon />}
            label="PiP"
            active={docPip.supported ? docPip.active : pipActive}
            onClick={() => {
              if (docPip.supported) docPip.toggle()
              else void togglePip()
              closeMore()
            }}
          />
        )}
        <GridTile
          icon={<FullscreenIcon />}
          label={isFullscreen ? 'Exit' : 'Full'}
          active={isFullscreen}
          onClick={() => {
            toggleFullscreen()
            closeMore()
          }}
        />
        {isHost && (
          <GridTile
            icon={<LockIcon />}
            label={locked ? 'Unlock' : 'Lock'}
            active={locked}
            onClick={onToggleLock}
          />
        )}
        {isHost && (
          <GridTile
            icon={<PeopleIcon />}
            label={waiting ? 'Lobby on' : 'Lobby off'}
            active={waiting}
            onClick={onToggleWaiting}
          />
        )}
      </div>

      <div className="mt-1 border-t border-line pt-1">
        <Section label="Effects">
          <MenuRow
            icon={<EffectsIcon />}
            label="Background effects"
            onClick={() => {
              setEffectsOpen(true)
              closeMore()
            }}
          />
        </Section>
        <Section label="Audio">
          <NoiseSuppression controls={noise} />
        </Section>
        <Section label="Devices">
          <DeviceSettings />
        </Section>
        <Section label="Preferences" last>
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
        </Section>
      </div>
    </div>
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
            <div className="max-h-[min(70vh,32rem)] w-80 max-w-[85vw] overflow-y-auto p-2">
              {moreContent}
            </div>
          </Popover>
        )}

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <EffectsDialog open={effectsOpen} onOpenChange={setEffectsOpen} controls={blur} />
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
        Removes keyboard, fan, and background noise.
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

/** Labeled group inside the More menu — a hairline-separated section header. */
function Section({ label, last, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cn(!last && 'mb-1 border-b border-line pb-1')}>
      <p className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-ink-subtle">{label}</p>
      {children}
    </div>
  )
}
