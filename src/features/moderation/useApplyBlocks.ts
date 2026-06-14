import { useEffect } from 'react'
import { useParticipants } from '@livekit/components-react'
import type { RemoteParticipant } from 'livekit-client'
import { useBlockStore } from '@/store/useBlockStore'

/**
 * Enforces local blocks on audio: silences blocked remote participants for this
 * client (tiles are hidden separately in the Stage). Mounted once in the room.
 */
export function useApplyBlocks() {
  const participants = useParticipants()
  const blocked = useBlockStore((s) => s.blocked)

  useEffect(() => {
    participants.forEach((p) => {
      if (p.isLocal) return
      const rp = p as RemoteParticipant
      if (typeof rp.setVolume === 'function') {
        rp.setVolume(blocked.includes(p.identity) ? 0 : 1)
      }
    })
  }, [participants, blocked])
}
