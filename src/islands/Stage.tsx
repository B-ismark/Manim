import { useMemo, useRef } from 'react'
import {
  useTracks,
  VideoTrack,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useRoomInfo,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Avatar, Button, IconButton } from '@/components/primitives'
import { CopyIcon, CheckIcon, EffectsIcon, FlipCameraIcon, HandIcon, MicOffIcon, PinIcon } from '@/components/icons'
import { moderate } from '@/lib/orchestrator'
import { useAppStore } from '@/store/useAppStore'
import { useFlipCamera } from '@/lib/useFlipCamera'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { useHandRaised } from '@/features/reactions/useReactions'
import { useRoomStore } from '@/store/useRoomStore'
import { useEffectsUi } from '@/store/useEffectsUi'
import { useBlockStore } from '@/store/useBlockStore'
import { useCopyLink } from '@/lib/useCopyLink'
import { useDraggable } from '@/lib/useDraggable'
import { isMyOtherDevice, useMyUserId } from '@/lib/identity'
import { useIsTouch } from '@/lib/useIsTouch'
import { focusTrack, isLocalCam } from '@/lib/focusTrack'
import { cn } from '@/lib/cn'

/**
 * Column count for the tile grid. Phones cap at 2 (portrait tiles stay legible;
 * the grid scrolls past the fold rather than shrinking to thumbnails). Desktop
 * grows with √n up to 4. Tiles keep a 3:4 portrait aspect.
 */
function gridColumns(n: number, coarse: boolean): number {
  if (n <= 1) return 1
  if (coarse) return 2
  return Math.min(Math.ceil(Math.sqrt(n)), 4)
}

export function Stage() {
  const layout = useRoomStore((s) => s.layout)
  const pinned = useRoomStore((s) => s.pinned)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const participants = useParticipants()
  const blocked = useBlockStore((s) => s.blocked)
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ).filter((t) => t.participant.isLocal || !blocked.includes(t.participant.identity))

  const coarse = useIsTouch()

  if (participants.length <= 1 && tracks.length <= 1) {
    return <SoloStage selfTrack={tracks[0]} />
  }

  // On phones a 1-on-1 reads best as remote-fills + floating self-PiP (Discord/
  // Meet), not two equal tiles — route it through the focus layout even in grid.
  const screenShare = tracks.some((t) => t.source === Track.Source.ScreenShare)
  const phone1on1 = coarse && tracks.length === 2 && !screenShare

  if ((layout === 'grid' && !phone1on1) || tracks.length <= 1) {
    // "Hide self view" drops your own camera tile from the grid too (it only hid
    // the floating self-card in speaker layout before). Keep it if it's the only
    // tile, so the grid never goes empty.
    const gridTracks =
      selfViewHidden && tracks.some((t) => !isLocalCam(t)) ? tracks.filter((t) => !isLocalCam(t)) : tracks
    const cols = gridColumns(gridTracks.length, coarse)
    // Centre when the tiles fit; otherwise scroll from the top (so nothing is
    // ever clipped above the fold — the 3+-on-mobile breakage).
    const many = gridTracks.length > cols * 2
    return (
      <div
        className={cn(
          'grid min-h-0 flex-1 justify-center gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3',
          many ? 'content-start' : 'content-center',
        )}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {gridTracks.map((ref) => (
          // Portrait 3:4 tile; fills its column, object-cover. Grid scrolls past
          // the fold for large calls rather than shrinking tiles to dots.
          <div key={`${ref.participant.identity}-${ref.source}`} className="aspect-[3/4] min-h-0">
            <Tile trackRef={ref} fill />
          </div>
        ))}
      </div>
    )
  }

  // Speaker (and phone 1-on-1): a focused remote (or screen share)
  // fills the stage and the local camera floats as a draggable self-view
  // (STYLE.md §2 island model).
  const localCam = tracks.find(isLocalCam)
  const others = tracks.filter((t) => !isLocalCam(t))
  const focus = focusTrack(others, pinned) ?? localCam
  const filmstrip = others.filter((t) => t !== focus)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-3">
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

      {localCam && focus !== localCam && !selfViewHidden && <SelfViewCard trackRef={localCam} />}
    </div>
  )
}

/** Alone in the call: show your own camera (like Teams/Meet) + an invite hint. */
function SoloStage({ selfTrack }: { selfTrack?: TrackReferenceOrPlaceholder }) {
  const { copied, copy } = useCopyLink()
  const coarse = useIsTouch()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-2 pb-24 sm:gap-5 sm:p-4 sm:pb-28">
      {/* Touch (phones): a tall portrait card that fills the available height
          (Meet/Gmail self-view), invite below. Desktop (mouse): a constrained
          landscape card — full height would waste the wide canvas. */}
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-tile',
          // Touch: a tall portrait card, but height-capped so the invite below
          // stays on-screen (flex-1 ate the whole viewport and pushed it off).
          coarse
            ? 'aspect-[3/4] w-full max-w-[18rem] max-h-[55dvh]'
            : 'aspect-video w-full max-w-3xl max-h-[55dvh]',
        )}
      >
        {selfTrack ? (
          <Tile trackRef={selfTrack} fill />
        ) : (
          <div className="grid size-full place-items-center bg-sunken text-sm text-ink-subtle">
            Camera off
          </div>
        )}
      </div>
      <div className="shrink-0 text-center">
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

/** Floating, draggable local camera shown in the speaker layout. */
function SelfViewCard({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const { style, handlers } = useDraggable()
  return (
    <div
      role="group"
      aria-label="Your video — drag to reposition"
      data-no-stage-gesture
      style={style}
      {...handlers}
      className={cn(
        'fixed bottom-24 right-4 z-20 cursor-grab touch-none select-none active:cursor-grabbing',
        // Touch: a tall portrait card (Discord/Snapchat self-view). Desktop:
        // a wider landscape thumbnail.
        'w-24 aspect-[3/4] pointer-fine:w-52 pointer-fine:aspect-video',
        'overflow-hidden rounded-tile shadow-raised ring-1 ring-white/10',
      )}
    >
      <Tile trackRef={trackRef} fill />
    </div>
  )
}

/** Tiny animated equalizer — a non-color "speaking" cue (paired with the ring). */
function SpeakingBars() {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {[0, 0.15, 0.3].map((delay) => (
        <span
          key={delay}
          className="mn-eq w-[2px] rounded-full bg-current"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  )
}

function Tile({ trackRef, fill = false }: { trackRef: TrackReferenceOrPlaceholder; fill?: boolean }) {
  const p = trackRef.participant
  const name = p.name || p.identity.split('#')[0]
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const { metadata: roomMetadata } = useRoomInfo()
  const roomToken = useAppStore((s) => s.roomToken)
  const myUserId = useMyUserId()

  // Am I allowed to moderate? (primary host or co-host — same rule the server
  // re-checks.) Drives the per-tile mute affordance on *other* people's tiles.
  const canModerate = useMemo(() => {
    try {
      const f = JSON.parse(roomMetadata || '{}')
      const me = localParticipant.identity
      return f.hostId === me || (Array.isArray(f.coHosts) && f.coHosts.includes(me))
    } catch {
      return false
    }
  }, [roomMetadata, localParticipant.identity])

  async function forceMute() {
    if (!roomToken) return
    const trackSid = p.getTrackPublication(Track.Source.Microphone)?.trackSid
    try {
      await moderate({ room: room.name, token: roomToken, target: p.identity, action: 'mute', trackSid, source: 'microphone' })
    } catch {
      /* surfaced elsewhere */
    }
  }
  const myOtherDevice = isMyOtherDevice(p, myUserId)
  const isScreen = trackRef.source === Track.Source.ScreenShare
  // For the local participant we are never "subscribed" to our own track, so
  // gate only on presence + mute; remote tiles still require a subscription.
  const pub = trackRef.publication
  // Audio-only mode renders avatars instead of decoding camera video (screen
  // share still shows — it's the point of sharing).
  const audioOnly = useRoomStore((s) => s.audioOnly)
  const hasVideo =
    !!pub && !pub.isMuted && (p.isLocal || !!pub.isSubscribed) && (isScreen || !audioOnly)
  const speaking = p.isSpeaking
  const micOff = !p.isMicrophoneEnabled
  const handRaised = useHandRaised(p)

  const pinned = useRoomStore((s) => s.pinned) === p.identity
  const togglePin = useRoomStore((s) => s.togglePin)
  // Mirror only the front ('user') self camera — a mirrored rear camera shows
  // the world flipped (text backwards, etc).
  const selfFacing = useRoomStore((s) => s.selfFacing)
  const mirror = p.isLocal && !isScreen && selfFacing === 'user'

  // Self-view tile controls (flip camera / effects) live ON the tile now, like
  // WhatsApp/Snapchat — keeps them off the control bar. Touch only (desktop uses
  // the device picker + the More menu).
  const coarse = useIsTouch()
  const flipCamera = useFlipCamera()
  const toggleEffects = useEffectsUi((s) => s.toggleCarousel)
  const showSelfTools = p.isLocal && !isScreen && hasVideo && coarse

  // Long-press to pin (touch) — a second, more discoverable gesture alongside
  // double-tap. A drag (swipe to switch layout) cancels it.
  const pressTimer = useRef<number | undefined>(undefined)
  const startPress = () => {
    pressTimer.current = window.setTimeout(() => togglePin(p.identity), 500)
  }
  const cancelPress = () => window.clearTimeout(pressTimer.current)

  return (
    <div
      // Double-tap (or long-press) a tile to pin it; single tap bubbles
      // to the stage chrome toggle on mobile. Mirrors Zoom/Telegram/Discord.
      onDoubleClick={() => togglePin(p.identity)}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={cancelPress}
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
            'mn-video-in size-full',
            isScreen ? 'bg-black object-contain' : 'object-cover',
            mirror && '[transform:scaleX(-1)]',
          )}
        />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar name={name} size={fill ? 'xl' : 'lg'} />
        </div>
      )}

      {/* Top-left cluster — opposing the pin (top-right). On *other* people's
          tiles a host gets a quick mute button (hover/focus reveal, like the
          pin). You can't unmute someone else (LiveKit/privacy), so once they're
          muted the affordance drops and the name-row mic-off icon carries the
          status. Mute yourself from the bottom control bar. Hand badge stacks
          underneath. */}
      <div
        className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {!p.isLocal && canModerate && !micOff && (
          <IconButton
            size="sm"
            label={`Mute ${name}`}
            icon={<MicOffIcon />}
            className="bg-overlay text-white opacity-0 transition-opacity duration-[var(--dur-fast)] hover:bg-overlay focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => void forceMute()}
          />
        )}
        {handRaised && (
          <span className="flex items-center gap-1 rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-warning">
            <HandIcon className="size-3" /> Hand
          </span>
        )}
      </div>

      {/* Flip camera + effects, anchored to your own tile (Snapchat/WhatsApp).
          Touch only. Bottom-right (above the name row) so they clear the
          screen-level participants chip in the top-right corner. */}
      {showSelfTools && (
        <div
          className="absolute bottom-12 right-2 z-10 flex flex-col gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton
            size="sm"
            label="Flip camera"
            icon={<FlipCameraIcon />}
            className="bg-overlay text-white hover:bg-overlay"
            onClick={() => void flipCamera()}
          />
          <IconButton
            size="sm"
            label="Effects"
            icon={<EffectsIcon />}
            className="bg-overlay text-white hover:bg-overlay"
            onClick={toggleEffects}
          />
        </div>
      )}

      {/* Pin toggle — reveals on hover/focus (desktop). On touch there's no
          hover and the top-right corner is taken by the participants chip, so we
          rely on double-tap to pin (taught once by PinCoachmark) instead. */}
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
          {micOff ? (
            <MicOffIcon className="size-3" />
          ) : (
            speaking && <SpeakingBars />
          )}
          <span className="max-w-40 truncate">
            {name}
            {p.isLocal ? ' (you)' : myOtherDevice ? ' (your device)' : ''}
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
