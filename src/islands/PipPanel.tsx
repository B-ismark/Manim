import {
  useLocalParticipant,
  useParticipants,
  useTracks,
  VideoTrack,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Avatar, IconButton } from '@/components/primitives'
import {
  CameraIcon,
  CameraOffIcon,
  ExitFullscreenIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
} from '@/components/icons'
import { focusTrack, hasVideo, isLocalCam } from '@/lib/focusTrack'
import { useRoomStore } from '@/store/useRoomStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { cn } from '@/lib/cn'

/**
 * Compact whole-app view rendered into the Document PiP window: the focused
 * speaker/screen-share fills the frame; the call controls float as a single
 * translucent island *over* the video (so nothing steals vertical space) — mic,
 * camera, screen-share, back-to-window, leave. The root is overflow-hidden and
 * everything is sized in relative/viewport units, so a resized PiP window never
 * grows a scrollbar and the layout stays neat at any size (Meet/Teams style).
 */
export function PipPanel({ onLeave, onClose }: { onLeave: () => void; onClose?: () => void }) {
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const pinned = useRoomStore((s) => s.pinned)
  const coarse = useIsTouch()
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  // Prefer a remote/screen focus; only show self when alone.
  const localCam = tracks.find(isLocalCam)
  const others = tracks.filter((t) => !isLocalCam(t))
  const focus = focusTrack(others, pinned) ?? localCam
  const p = focus?.participant
  const name = p ? p.name || p.identity.split('#')[0] : ''
  const selfFacing = useRoomStore((s) => s.selfFacing)
  // Mirror the front self camera only (rear camera mirrored = flipped world).
  const mirror = focus ? isLocalCam(focus) && selfFacing === 'user' : false
  const showVideo = focus ? hasVideo(focus) : false

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-stage text-ink">
      {/* Video / avatar fills the whole frame. */}
      {focus && showVideo ? (
        <VideoTrack
          trackRef={focus as Parameters<typeof VideoTrack>[0]['trackRef']}
          className={cn('absolute inset-0 size-full object-cover', mirror && '[transform:scaleX(-1)]')}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          {name ? (
            <Avatar name={name} size="xl" />
          ) : (
            <p className="text-sm text-ink-subtle">{participants.length} in call</p>
          )}
        </div>
      )}

      {/* Top overlay: who's in focus (left) + back-to-window (right). */}
      {name && (
        <span className="absolute left-2 top-2 max-w-[60%] truncate rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-white">
          {name}
          {p?.isLocal ? ' (you)' : ''}
        </span>
      )}
      {onClose && (
        <div className="absolute right-2 top-2">
          <IconButton
            size="sm"
            label="Back to window"
            icon={<ExitFullscreenIcon />}
            className="bg-overlay text-white hover:bg-overlay"
            onClick={onClose}
          />
        </div>
      )}

      {/* Floating control island — overlays the video, wraps on a narrow window. */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-2">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-control bg-overlay px-2 py-1.5 shadow-raised backdrop-blur-md">
          <IconButton
            size="sm"
            label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            icon={isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            tone={isMicrophoneEnabled ? 'neutral' : 'danger'}
            active={!isMicrophoneEnabled}
            className={isMicrophoneEnabled ? 'bg-transparent text-white hover:bg-white/15' : undefined}
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          />
          <IconButton
            size="sm"
            label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            icon={isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
            tone={isCameraEnabled ? 'neutral' : 'danger'}
            active={!isCameraEnabled}
            className={isCameraEnabled ? 'bg-transparent text-white hover:bg-white/15' : undefined}
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
          />
          {/* Screen share — desktop only (touch can't). */}
          {!coarse && (
            <IconButton
              size="sm"
              label={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}
              icon={<ScreenShareIcon />}
              active={isScreenShareEnabled}
              className={!isScreenShareEnabled ? 'bg-transparent text-white hover:bg-white/15' : undefined}
              onClick={() => void localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
            />
          )}
          <IconButton size="sm" label="Leave call" icon={<LeaveIcon />} tone="danger" onClick={onLeave} />
        </div>
      </div>
    </div>
  )
}
