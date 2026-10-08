import { useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { NO_HOLD, nextCheckIn, nextSpeakerHold, type SpeakerHold } from '@/lib/speakerHold'

/**
 * The remote identity that holds the speaker view's big region (see speakerHold).
 *
 * Driven by the room's own events rather than by re-renders: `ActiveSpeakersChanged`
 * and departures re-evaluate it, and a timer covers the one case no event announces
 * — a challenger who simply keeps talking past the dwell. It only causes a render
 * when the holder actually changes. You are never a candidate: the stage never
 * picks you automatically (stageFocus), so your own voice must not move it either.
 */
export function useHeldSpeaker(): string | null {
  const room = useRoomContext()
  const [held, setHeld] = useState<string | null>(null)

  useEffect(() => {
    let hold: SpeakerHold = NO_HOLD
    let timer: ReturnType<typeof setTimeout> | undefined

    const evaluate = () => {
      clearTimeout(timer)
      const now = performance.now()
      const speaking = room.activeSpeakers.filter((p) => !p.isLocal).map((p) => p.identity)
      hold = nextSpeakerHold(hold, speaking, (id) => room.remoteParticipants.has(id), now)
      setHeld(hold.held)
      const wait = nextCheckIn(hold, now)
      if (wait !== null) timer = setTimeout(evaluate, wait + 20)
    }

    room
      .on(RoomEvent.ActiveSpeakersChanged, evaluate)
      .on(RoomEvent.ParticipantDisconnected, evaluate)
    evaluate()
    return () => {
      clearTimeout(timer)
      room
        .off(RoomEvent.ActiveSpeakersChanged, evaluate)
        .off(RoomEvent.ParticipantDisconnected, evaluate)
    }
  }, [room])

  return held
}
