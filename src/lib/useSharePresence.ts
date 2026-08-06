import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { annotateEnabled } from '@/features/annotate/useAnnotate'

export interface SharePresence {
  /** You are publishing a screen share. */
  presenting: boolean
  /** Somebody else is — their screen owns the big region, and yours stays out. */
  remoteSharing: boolean
  /** You are drawing on your OWN share (armed, allowed, and yours is the one shown). */
  annotatingOwnShare: boolean
}

/**
 * Who is sharing, and whether you're drawing on your own share.
 *
 * Split out because two places need the same answer and must not drift: Stage
 * decides the LAYOUT from it (your own share is shown to you unless a remote one
 * wins), and RoomView renders the status pill that explains that layout. When those
 * disagreed, the pill said "You're drawing on your shared screen" over a stage that
 * was showing something else.
 */
export function useSharePresence(): SharePresence {
  const shares = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
  const presenting = shares.some((t) => t.participant.isLocal)
  const remoteSharing = shares.some((t) => !t.participant.isLocal)
  const active = useAnnotateStore((s) => s.active)
  const coarse = useIsTouch()
  return {
    presenting,
    remoteSharing,
    annotatingOwnShare: presenting && !remoteSharing && annotateEnabled && active && !coarse,
  }
}
