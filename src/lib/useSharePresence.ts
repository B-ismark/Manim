import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { useRoomStore } from '@/store/useRoomStore'
import { annotateEnabled } from '@/features/annotate/useAnnotate'

export interface SharePresence {
  /** You are publishing a screen share. */
  presenting: boolean
  /** Somebody else is — their screen owns the big region, and yours stays out. */
  remoteSharing: boolean
  /** You are drawing on your OWN share (armed, allowed, and yours is the one shown). */
  annotatingOwnShare: boolean
  /**
   * Your own share is echoed onto your stage.
   *
   * False when a remote share wins, and false by default when you're sharing a whole
   * MONITOR: that echo is what recursed into a mirror tunnel and re-captured your own
   * cursor. An explicit override (the toggle on the presenting pill) beats both the
   * surface-type default and a browser that reports no surface type at all.
   */
  ownShareShown: boolean
  /** You're sharing your whole screen — the case where echoing it back recurses. */
  sharingMonitor: boolean
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
  const shareSurface = useRoomStore((s) => s.shareSurface)
  const override = useRoomStore((s) => s.showOwnShareOverride)

  const sharingMonitor = presenting && shareSurface === 'monitor'
  // 'unknown' lands on the permissive side deliberately — a browser that doesn't
  // report displaySurface would otherwise lose the self-view (and with it the
  // discoverable path to annotation) on every share it ever starts.
  const ownShareShown =
    presenting && !remoteSharing && (override ?? !sharingMonitor)

  return {
    presenting,
    remoteSharing,
    ownShareShown,
    sharingMonitor,
    annotatingOwnShare: ownShareShown && annotateEnabled && active && !coarse,
  }
}
