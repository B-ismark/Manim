import { useEffect } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { useRoomStore } from '@/store/useRoomStore'
import { featuredShare, shareId } from '@/lib/focusTrack'
import { MAX_CONCURRENT_SHARES } from '@/features/calls/useScreenShare'
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
  /**
   * A screen share is in the BIG region right now — so a drawing surface exists.
   *
   * Not "a share exists". Demote the share to the grid, or spotlight a person, and
   * the canvas unmounts while a share is still very much being published.
   */
  shareFeatured: boolean
  /**
   * Drawing is possible AND permitted right now. The single condition the pen
   * controls render on and the single one that disarms it.
   *
   * There were two disarm paths before this (the last share ending, and losing
   * permission), and F6/F8 would have added a third and a fourth. Four independent
   * effects racing to clear one flag is how they drift; this is one derived value
   * with one effect behind it.
   */
  canAnnotate: boolean
  /** Track SID of the share in the big region — what ink drawn now is aimed at. */
  featuredShareId: string | null
  /**
   * Every share slot is taken by someone else, so this person cannot start one.
   * False while YOU are sharing — you hold one of the slots and may always stop.
   * The reason lives on the disabled control; a button that silently does nothing
   * reads as broken, and the fix ("ask someone to stop") is not guessable.
   */
  shareSlotsFull: boolean
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
  const allowed = useAnnotateStore((s) => s.allowed)
  const shareSurface = useRoomStore((s) => s.shareSurface)
  const override = useRoomStore((s) => s.showOwnShareOverride)
  const demotedShares = useRoomStore((s) => s.demotedShares)
  const spotlightKey = useRoomStore((s) => s.spotlightKey)
  const stickyShareId = useRoomStore((s) => s.stickyShareId)
  const setStickyShare = useRoomStore((s) => s.setStickyShare)

  const shareSlotsFull = !presenting && shares.length >= MAX_CONCURRENT_SHARES

  const sharingMonitor = presenting && shareSurface === 'monitor'
  // 'unknown' lands on the permissive side deliberately — a browser that doesn't
  // report displaySurface would otherwise lose the self-view (and with it the
  // discoverable path to annotation) on every share it ever starts.
  const ownShareShown =
    presenting && !remoteSharing && (override ?? !sharingMonitor)

  // Only shares that are actually on this viewer's stage can be featured — your own
  // is excluded exactly when the stage excludes it, so the pen can never point at a
  // surface you are not being shown.
  const onStage = shares.filter((t) => !t.participant.isLocal || ownShareShown)
  const featured = featuredShare(onStage, { demotedShares, spotlightKey, stickyShareId })
  const shareFeatured = featured !== undefined
  const featuredShareId = featured ? shareId(featured) : null

  // Remember the choice so it survives someone starting to talk. Written in an
  // effect, not during render — this is a store write, and the store is what the
  // next render reads back.
  useEffect(() => {
    if (featuredShareId) setStickyShare(featuredShareId)
  }, [featuredShareId, setStickyShare])

  // Touch is view-only by design: drawing has to capture touch, which fights the
  // control bar's tap-to-reveal. Touch devices still SEE everyone's ink.
  const canAnnotate = annotateEnabled && shareFeatured && allowed && !coarse

  return {
    presenting,
    remoteSharing,
    ownShareShown,
    sharingMonitor,
    shareFeatured,
    canAnnotate,
    featuredShareId,
    shareSlotsFull,
    annotatingOwnShare: ownShareShown && active && canAnnotate,
  }
}
