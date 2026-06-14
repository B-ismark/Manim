import {
  useLocalParticipant,
  useParticipants,
  useTracks,
  VideoTrack,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Avatar, IconButton } from '@/components/primitives'
import { CameraIcon, CameraOffIcon, LeaveIcon, MicIcon, MicOffIcon } from '@/components/icons'
import { focusTrack, hasVideo, isLocalCam } from '@/lib/focusTrack'
import { useRoomStore } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

/**
 * Compact whole-app view rendered into the Document PiP window: the focused
 * speaker/screen-share fills the frame, with live mic/camera/leave controls —
 * so the call stays usable while the main tab is hidden (Meet/Teams style).
 */
export function PipPanel({ onLeave }: { onLeave: () => void }) {
  const participants = useParticipants()
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const pinned = useRoomStore((s) => s.pinned)
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
  const mirror = focus ? isLocalCam(focus) : false
  const showVideo = focus ? hasVideo(focus) : false

  return (
    <div className="flex h-screen w-screen flex-col bg-stage text-ink">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {focus && showVideo ? (
          <VideoTrack
            trackRef={focus as Parameters<typeof VideoTrack>[0]['trackRef']}
            className={cn('size-full object-cover', mirror && '[transform:scaleX(-1)]')}
          />
        ) : (
          <div className="grid size-full place-items-center">
            {name ? <Avatar name={name} size="xl" /> : (
              <p className="text-sm text-ink-subtle">{participants.length} in call</p>
            )}
          </div>
        )}
        {name && (
          <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-white">
            {name}
            {p?.isLocal ? ' (you)' : ''}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 p-2">
        <IconButton
          size="sm"
          label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          icon={isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
          tone={isMicrophoneEnabled ? 'neutral' : 'danger'}
          active={!isMicrophoneEnabled}
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <IconButton
          size="sm"
          label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          icon={isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
          tone={isCameraEnabled ? 'neutral' : 'danger'}
          active={!isCameraEnabled}
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        />
        <IconButton
          size="sm"
          label="Leave call"
          icon={<LeaveIcon />}
          tone="danger"
          onClick={onLeave}
        />
      </div>
    </div>
  )
}
