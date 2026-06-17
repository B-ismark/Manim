import { useCallback } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { useRoomStore } from '@/store/useRoomStore'
import { toast } from '@/store/useToastStore'

/**
 * Mobile front/rear camera flip. Restarts the local camera track with the
 * opposite facing mode and records it so the self-view mirror only applies to the
 * front camera (a mirrored rear camera shows the world flipped). Desktops use the
 * device picker instead. Lives on the self-view tile now (WhatsApp/Messenger
 * convention) rather than the control bar.
 */
export function useFlipCamera() {
  const { localParticipant } = useLocalParticipant()
  const setSelfFacing = useRoomStore((s) => s.setSelfFacing)

  return useCallback(async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      | LocalVideoTrack
      | undefined
    if (!track) return
    const facing = track.mediaStreamTrack.getSettings().facingMode
    const next = facing === 'environment' ? 'user' : 'environment'
    try {
      await track.restartTrack({ facingMode: next })
      setSelfFacing(next)
    } catch {
      toast("Couldn't switch camera", 'danger')
    }
  }, [localParticipant, setSelfFacing])
}
