import { useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ParticipantEvent, Track, type LocalTrackPublication, type LocalVideoTrack } from 'livekit-client'
import { addBreadcrumb } from '@/lib/report'

/** How long the CPU limit has to last before the call steps down for it. */
export const STRAIN_CONFIRM_MS = 6000

/**
 * Is this device running out of CPU for the call? Latched: true for the rest of
 * the call once it has been.
 *
 * livekit-client watches your camera's encoder and raises
 * `LocalTrackCpuConstrained` when WebRTC reports `qualityLimitationReason: 'cpu'`.
 * Left alone, that state is the lag people describe: the encoder sheds frames
 * and resolution, and on a phone running blur and Krisp beside it the page itself
 * stutters. LiveKit's own guidance for it is to step down rather than wait —
 * lighter encoding, effects off, smaller incoming video — which is what the
 * consumers of this flag do (RoomView).
 *
 * The flag alone is too twitchy to act on: an encoder ramping up, or the moment
 * blur is switched on, can report 'cpu' for a second or two. So the event starts
 * a check, and only a limit still in force `STRAIN_CONFIRM_MS` later counts.
 *
 * On confirmation the camera is also switched to `prioritizePerformance()`
 * (one 360p/15fps layer), the encoder-side half of the same step down.
 *
 * Cameras only. The SDK raises the same event for a screen share, and stepping a
 * share down to 360p makes its text unreadable for everyone for the rest of the
 * share — a far worse trade than a share that drops frames. A share's encoder
 * limit is left to its own `maintain-resolution` preference.
 */
export function useDeviceStrain(): boolean {
  const room = useRoomContext()
  const [strained, setStrained] = useState(false)

  useEffect(() => {
    if (strained) return
    const lp = room.localParticipant
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false

    const onConstrained = (track: LocalVideoTrack, pub: LocalTrackPublication) => {
      if (timer || done || pub.source !== Track.Source.Camera) return
      timer = setTimeout(async () => {
        timer = undefined
        try {
          const stats = await track.getSenderStats()
          if (done || !stats.some((s) => s.qualityLimitationReason === 'cpu')) return
          done = true
          addBreadcrumb('device-strain: cpu limit held, stepping down')
          setStrained(true)
          await track.prioritizePerformance().catch(() => {})
        } catch {
          /* the track went away; nothing to step down */
        }
      }, STRAIN_CONFIRM_MS)
    }

    lp.on(ParticipantEvent.LocalTrackCpuConstrained, onConstrained)
    return () => {
      done = true
      clearTimeout(timer)
      lp.off(ParticipantEvent.LocalTrackCpuConstrained, onConstrained)
    }
  }, [room, strained])

  return strained
}
