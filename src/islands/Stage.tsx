import { useTracks, VideoTrack, useParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Avatar, Button, IconButton } from '@/components/primitives'
import { CopyIcon, CheckIcon, HandIcon, MicOffIcon, PinIcon } from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { useHandRaised } from '@/features/reactions/useReactions'
import { useRoomStore } from '@/store/useRoomStore'
import { useCopyLink } from '@/lib/useCopyLink'
import { useDraggable } from '@/lib/useDraggable'
import { cn } from '@/lib/cn'

/** Responsive column count — keeps tiles large and readable at any size. */
function gridCols(n: number): string {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-1 sm:grid-cols-2'
  if (n <= 9) return 'grid-cols-2 lg:grid-cols-3'
  return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
}

const isLocalCam = (t: TrackReferenceOrPlaceholder) =>
  t.participant.isLocal && t.source === Track.Source.Camera

/** Pick the focused track: explicit pin > active screen share > active speaker > first. */
function focusTrack(
  tracks: TrackReferenceOrPlaceholder[],
  pinned: string | null,
): TrackReferenceOrPlaceholder | undefined {
  if (pinned) {
    const byPin =
      tracks.find((t) => t.participant.identity === pinned && t.source === Track.Source.Camera) ??
      tracks.find((t) => t.participant.identity === pinned)
    if (byPin) return byPin
  }
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare)
  if (screen) return screen
  const speaking = tracks.find((t) => t.participant.isSpeaking)
  return speaking ?? tracks[0]
}

export function Stage() {
  const layout = useRoomStore((s) => s.layout)
  const pinned = useRoomStore((s) => s.pinned)
  const participants = useParticipants()
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  if (participants.length <= 1 && tracks.length <= 1) {
    return <SoloStage selfTrack={tracks[0]} />
  }

  if (layout === 'grid' || tracks.length <= 1) {
    return (
      <div className={cn('grid flex-1 content-center gap-3 p-3', gridCols(tracks.length))}>
        {tracks.map((ref) => (
          <Tile key={`${ref.participant.identity}-${ref.source}`} trackRef={ref} />
        ))}
      </div>
    )
  }

  // Speaker / spotlight: a focused remote (or screen share) fills the stage and
  // the local camera floats as a draggable self-view (STYLE.md §2 island model).
  const localCam = tracks.find(isLocalCam)
  const others = tracks.filter((t) => !isLocalCam(t))
  const focus = focusTrack(others, pinned) ?? localCam
  const filmstrip = others.filter((t) => t !== focus)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="min-h-0 flex-1">{focus && <Tile trackRef={focus} fill />}</div>

      {layout === 'speaker' && filmstrip.length > 0 && (
        <div className="flex h-24 shrink-0 gap-3 overflow-x-auto sm:h-28">
          {filmstrip.map((ref) => (
            <div key={`${ref.participant.identity}-${ref.source}`} className="aspect-video h-full shrink-0">
              <Tile trackRef={ref} fill />
            </div>
          ))}
        </div>
      )}

      {localCam && focus !== localCam && <SelfViewCard trackRef={localCam} />}
    </div>
  )
}

/** Alone in the call: show your own camera (like Teams/Meet) + an invite hint. */
function SoloStage({ selfTrack }: { selfTrack?: TrackReferenceOrPlaceholder }) {
  const { copied, copy } = useCopyLink()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-4">
      <div className="aspect-video w-full max-w-3xl">
        {selfTrack ? (
          <Tile trackRef={selfTrack} fill />
        ) : (
          <div className="grid size-full place-items-center rounded-tile bg-sunken text-sm text-ink-subtle">
            Camera off
          </div>
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">You're the only one here</p>
        <p className="mt-1 text-xs text-ink-muted">Invite someone to join this call.</p>
        <Button variant="accent" className="mt-3" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Link copied' : 'Copy invite link'}
        </Button>
      </div>
    </div>
  )
}

/** Floating, draggable local camera shown in speaker / spotlight layouts. */
function SelfViewCard({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const { style, handlers } = useDraggable()
  return (
    <div
      role="group"
      aria-label="Your video — drag to reposition"
      style={style}
      {...handlers}
      className={cn(
        'fixed bottom-24 right-4 z-20 w-36 cursor-grab touch-none select-none active:cursor-grabbing sm:w-52',
        'aspect-video shadow-raised rounded-tile',
      )}
    >
      <Tile trackRef={trackRef} fill />
    </div>
  )
}

function Tile({ trackRef, fill = false }: { trackRef: TrackReferenceOrPlaceholder; fill?: boolean }) {
  const p = trackRef.participant
  const name = p.name || p.identity.split('#')[0]
  const isScreen = trackRef.source === Track.Source.ScreenShare
  // For the local participant we are never "subscribed" to our own track, so
  // gate only on presence + mute; remote tiles still require a subscription.
  const pub = trackRef.publication
  const hasVideo = !!pub && !pub.isMuted && (p.isLocal || !!pub.isSubscribed)
  const speaking = p.isSpeaking
  const micOff = !p.isMicrophoneEnabled
  const handRaised = useHandRaised(p)

  const pinned = useRoomStore((s) => s.pinned) === p.identity
  const togglePin = useRoomStore((s) => s.togglePin)

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-tile bg-sunken',
        fill ? 'size-full' : 'aspect-video',
        'ring-2 transition-[box-shadow] duration-[var(--dur-fast)]',
        speaking ? 'ring-[var(--color-speaking)]' : 'ring-transparent',
      )}
    >
      {hasVideo && pub ? (
        <VideoTrack
          trackRef={trackRef as Parameters<typeof VideoTrack>[0]['trackRef']}
          className={cn(
            'size-full',
            isScreen ? 'bg-black object-contain' : 'object-cover',
            p.isLocal && !isScreen && '[transform:scaleX(-1)]',
          )}
        />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar name={name} size={fill ? 'xl' : 'lg'} />
        </div>
      )}

      {handRaised && (
        <div className="absolute left-2 top-2">
          <span className="flex items-center gap-1 rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-warning">
            <HandIcon className="size-3" /> Hand
          </span>
        </div>
      )}

      {/* Pin toggle — reveals on hover/focus; always available via keyboard. */}
      <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-[var(--dur-fast)] focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          size="sm"
          label={pinned ? `Unpin ${name}` : `Pin ${name}`}
          icon={<PinIcon />}
          active={pinned}
          className="bg-overlay text-white hover:bg-overlay"
          onClick={() => togglePin(p.identity)}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2">
        <span className="flex items-center gap-1 rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-white">
          {micOff && <MicOffIcon className="size-3" />}
          <span className="max-w-40 truncate">
            {name}
            {p.isLocal ? ' (you)' : ''}
            {isScreen ? ' — screen' : ''}
          </span>
        </span>
        <span className="rounded-control bg-overlay p-1">
          <ConnectionQuality participant={p} />
        </span>
      </div>
    </div>
  )
}
