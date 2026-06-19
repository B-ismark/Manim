import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { useRoomStore, type GridSize } from '@/store/useRoomStore'
import { useEffectsUi } from '@/store/useEffectsUi'
import { useBlockStore } from '@/store/useBlockStore'
import { useCopyLink } from '@/lib/useCopyLink'
import { useDraggable } from '@/lib/useDraggable'
import { isMyOtherDevice, useMyUserId } from '@/lib/identity'
import { useIsTouch } from '@/lib/useIsTouch'
import { focusTrack, isLocalCam } from '@/lib/focusTrack'
import { toast } from '@/store/useToastStore'
import { useElementSize } from '@/lib/useElementSize'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

/** Stable per-tile key (identity + source) — never reshuffles as people speak. */
function tileKey(t: TrackReferenceOrPlaceholder): string {
  return `${t.participant.identity}-${t.source}`
}

/** Composed screen-reader label for a tile: who + their current state. Keeps the
 *  visual pills (icons) in sync with an accessible text equivalent (STYLE.md §6 —
 *  meaning never by color/icon alone). */
function tileLabel(opts: {
  name: string
  isLocal: boolean
  myOtherDevice: boolean
  isScreen: boolean
  micOff: boolean
  speaking: boolean
  handRaised: boolean
  hasVideo: boolean
  pinned: boolean
}): string {
  const who = opts.isScreen
    ? `${opts.name}’s screen share`
    : opts.isLocal
      ? `${opts.name} (you)`
      : opts.myOtherDevice
        ? `${opts.name} (your device)`
        : opts.name
  const states: string[] = []
  if (!opts.isScreen) {
    states.push(opts.micOff ? 'muted' : 'unmuted')
    if (opts.speaking) states.push('speaking')
    if (opts.handRaised) states.push('hand raised')
    if (!opts.hasVideo) states.push('camera off')
  }
  if (opts.pinned) states.push('pinned')
  return states.length ? `${who}, ${states.join(', ')}` : who
}

/** Does this track currently carry video (camera on, or a screen share)? Drives the
 *  "videos first" ordering — avatar/camera-off tiles sort to the back. */
function hasLiveVideo(t: TrackReferenceOrPlaceholder): boolean {
  if (t.source === Track.Source.ScreenShare) return true
  return !!t.publication && !t.publication.isMuted
}

/** Keep screen shares first, then your own camera, then everyone else — pins the
 *  share + your self-view to the first page and gives a stable tile order. */
function tilePriority(t: TrackReferenceOrPlaceholder): number {
  if (t.source === Track.Source.ScreenShare) return 0
  if (isLocalCam(t)) return 1
  return 2
}

/**
 * How many legible tiles fit in the stage without scrolling — drives the paged
 * grid. Columns are bounded by width at a minimum tile width (and √n so a
 * 5-person call doesn't spread to 4 thin columns); rows by height at a minimum
 * tile height. Recomputed on every resize so the layout adapts gracefully
 * (window resize, side-panel dock, orientation) instead of clipping or shrinking
 * tiles to dots. Returns {cols, perPage} — cols also drives the rendered grid.
 */
function gridCapacity(
  width: number,
  height: number,
  n: number,
  coarse: boolean,
  sizePref: GridSize,
): { cols: number; perPage: number } {
  const gap = coarse ? 8 : 12
  const minW = coarse ? 132 : 200
  const minH = coarse ? 116 : 150
  const maxCols = coarse ? 2 : 4
  // Hard cap so pagination ALWAYS engages for big rooms — independent of the
  // measured height (a flex chain can briefly report an unbounded grid height,
  // which would otherwise compute a perPage large enough to mount every tile).
  // Also bounds mounted <video>/DOM per page (perf), the point of paging.
  const MAX_PER_PAGE = coarse ? 9 : 20
  // User-chosen density (Teams "gallery size"): the page is exactly the picked count
  // — tiles shrink to fit, pager engages — clamped to what the device can legibly
  // hold. This overrides the auto fit-to-viewport below.
  if (sizePref !== 'auto') {
    const perPage = Math.max(1, Math.min(sizePref, MAX_PER_PAGE))
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(perPage))))
    return { cols, perPage }
  }
  // Before the first measure, fall back to a sane page so we don't flash a huge
  // mount of every tile.
  if (width < 2 || height < 2) {
    const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(n))))
    return { cols, perPage: coarse ? 4 : 9 }
  }
  const byWidth = Math.floor((width + gap) / (minW + gap))
  const bySqrt = Math.ceil(Math.sqrt(n))
  const cols = Math.max(1, Math.min(maxCols, byWidth, bySqrt))
  const rows = Math.max(1, Math.floor((height + gap) / (minH + gap)))
  return { cols, perPage: Math.max(1, Math.min(cols * rows, MAX_PER_PAGE)) }
}

/**
 * Snap a raw frame aspect (w/h) to a tidy bucket so one odd stream can't make a
 * grid row absurdly tall or wide. Portrait phones clamp to 3:4 (NOT raw 9:16 —
 * that blows out row height), wide cams to 16:9, near-square to 1:1. Mirrors the
 * AWS IVS portrait/square/landscape model. Unknown/camera-off tiles default to
 * 16:9 upstream so the grid stays calm until a real frame arrives.
 */
function bucketAspect(ratio: number): number {
  if (ratio <= 0.85) return 3 / 4
  if (ratio >= 1.2) return 16 / 9
  return 1
}

/**
 * Split an ORDERED aspect list into `rows` contiguous groups, balancing the summed
 * aspect per row so rows come out near-equal width. Contiguous (never reorders) so
 * tile order — and thus paging — stays stable. Each remaining row is guaranteed at
 * least one tile. Greedy cumulative-threshold split; ample for a page's worth.
 */
function balancedRows(aspects: number[], rows: number): number[][] {
  const r = Math.min(rows, aspects.length)
  if (r <= 1) return [aspects.slice()]
  const total = aspects.reduce((s, a) => s + a, 0)
  const out: number[][] = []
  let cur: number[] = []
  let acc = 0
  for (let i = 0; i < aspects.length; i++) {
    cur.push(aspects[i])
    acc += aspects[i]
    const rowsDone = out.length
    const tilesLeft = aspects.length - i - 1
    const rowsLeft = r - rowsDone - 1
    // Close the row once it crosses its share of the total, but only while there
    // are still enough tiles to give every remaining row at least one.
    if (rowsDone < r - 1 && acc >= (total * (rowsDone + 1)) / r && tilesLeft >= rowsLeft) {
      out.push(cur)
      cur = []
      acc = 0
    }
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * Mixed-orientation grid packer (Google Meet "dynamic layouts" model). Lays `n`
 * tiles of VARYING aspect into justified equal-width rows, picking the row count
 * that maximizes the smallest tile (legibility). Each row is scaled to fill the
 * width; if the stack would overflow the height it's scaled down uniformly and
 * centered — so it always fits without scrolling. Returns per-tile {w,h} grouped
 * by row, in the original (contiguous) order. Replaces the old single-aspect fit:
 * a portrait phone feed now gets a portrait tile beside a laptop's 16:9, instead
 * of being center-cropped into a shared 16:9 cell.
 */
function fitMixedRows(
  width: number,
  height: number,
  aspects: number[],
  gap: number,
): { w: number; h: number }[][] {
  const n = aspects.length
  if (n === 0 || width <= 0 || height <= 0) return []
  let best: { score: number; rows: { w: number; h: number }[][] } = { score: -1, rows: [] }
  for (let R = 1; R <= n; R++) {
    const groups = balancedRows(aspects, R)
    const rr = groups.length
    // Row height that fills the width at this row's combined aspect.
    const rowH = groups.map((g) => {
      const sum = g.reduce((s, a) => s + a, 0)
      return (width - gap * (g.length - 1)) / sum
    })
    if (rowH.some((h) => h <= 0)) continue
    // Scale rows to the height left AFTER the inter-row gaps — gaps are fixed, so
    // they must come out of the budget first or the stack overflows by a few px.
    const sumH = rowH.reduce((s, h) => s + h, 0)
    const availH = height - gap * (rr - 1)
    if (availH <= 0) continue
    const scale = sumH > availH ? availH / sumH : 1
    const sized = groups.map((g, ri) => {
      const h = rowH[ri] * scale
      return g.map((a) => ({ w: h * a, h }))
    })
    // Score by the smallest tile (legibility). R ascends, so a later (taller) row
    // count must beat the current best by a clear margin to win — otherwise we keep
    // the wider, fewer-row layout, matching the Zoom/Meet desktop norm (a 1-on-1
    // sits side-by-side, not stacked, on a near-tie).
    const minH = Math.min(...rowH) * scale
    if (minH > best.score * 1.05) best = { score: minH, rows: sized }
  }
  return best.rows
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

  // A screen share always claims the spotlight (content fills the stage, people
  // collapse to a filmstrip) — the Meet/Zoom/Teams convention. Forcing it out of the
  // grid fixes the "share is just another equal tile, pillarboxed into 16:9/3:4" look:
  // even in grid layout, sharing routes through the focus layout below.
  if ((layout === 'grid' && !phone1on1 && !screenShare) || tracks.length <= 1) {
    // "Hide self view" drops your own camera tile from the grid too (it only hid
    // the floating self-card in speaker layout before). Keep it if it's the only
    // tile, so the grid never goes empty.
    const gridTracks =
      selfViewHidden && tracks.some((t) => !isLocalCam(t)) ? tracks.filter((t) => !isLocalCam(t)) : tracks
    return <GridStage tracks={gridTracks} coarse={coarse} />
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

      {(layout === 'speaker' || screenShare) && filmstrip.length > 0 && (
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

/**
 * Fit-to-viewport tile grid with grouped pages (Meet/Teams model). When everyone
 * fits on one page it renders exactly like a normal grid (no pager). When they
 * don't, tiles are grouped into pages instead of scrolling a giant grid or
 * shrinking to dots — and only the current page's tiles mount, so a 40-person
 * room decodes one page's worth, not 40. Screen shares + your self-view are
 * pinned to page 1; a stable order keeps tiles from reshuffling as people speak.
 */
function GridStage({
  tracks,
  coarse,
}: {
  tracks: TrackReferenceOrPlaceholder[]
  coarse: boolean
}) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [page, setPage] = useState(0)
  const gridSize = useRoomStore((s) => s.gridSize)
  const videosFirst = useRoomStore((s) => s.videosFirst)

  // Stable order: screen share → self → others, then by key. Never reorders on
  // speech (that would make tiles jump between pages mid-sentence). When "videos
  // first" is on, camera-on tiles sort ahead of avatars so the active video lands
  // on page 1 — a coarser, far less frequent reshuffle than speaking would cause.
  const ordered = useMemo(
    () =>
      [...tracks].sort((a, b) => {
        if (videosFirst) {
          const d = Number(hasLiveVideo(b)) - Number(hasLiveVideo(a))
          if (d) return d
        }
        return tilePriority(a) - tilePriority(b) || tileKey(a).localeCompare(tileKey(b))
      }),
    [tracks, videosFirst],
  )

  const { perPage } = gridCapacity(size.width, size.height, ordered.length, coarse, gridSize)
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage))
  // Clamp the page if the count shrank (resize, people left) — keep it in range.
  const current = Math.min(page, pageCount - 1)
  useEffect(() => {
    if (page !== current) setPage(current)
  }, [page, current])

  const start = current * perPage
  const shown = ordered.slice(start, start + perPage)
  const paged = pageCount > 1

  // Per-publisher aspect (Meet "dynamic layouts"): each tile takes its real frame
  // orientation, not a viewer-device guess — so a portrait phone feed gets a
  // portrait tile beside a laptop's 16:9 instead of being center-cropped into a
  // shared cell. Tiles report their video's intrinsic ratio up; unknown/camera-off
  // tiles default to 16:9 so the grid stays calm until a frame lands.
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const reportAspect = useCallback((key: string, ratio: number) => {
    setAspects((prev) => {
      if (prev[key] && Math.abs(prev[key] - ratio) < 0.02) return prev
      return { ...prev, [key]: ratio }
    })
  }, [])

  const gap = coarse ? 8 : 12
  const measured = size.width > 2 && size.height > 2
  // Snap to buckets at pack time (raw ratios stored) so a stream nudging across a
  // boundary doesn't thrash the layout.
  const rows = useMemo(() => {
    if (!measured) return null
    const arr = shown.map((t) => bucketAspect(aspects[tileKey(t)] ?? 16 / 9))
    return fitMixedRows(size.width, size.height, arr, gap)
  }, [measured, shown, aspects, size.width, size.height, gap])

  // If someone is speaking on a page you're not looking at, offer a one-tap jump
  // (no auto-jump — that's jarring). Manual + clearly labelled.
  const speakingPage = useMemo(() => {
    const i = ordered.findIndex((t) => t.participant.isSpeaking)
    return i >= 0 ? Math.floor(i / perPage) : -1
  }, [ordered, perPage])
  const speakerOffPage = paged && speakingPage >= 0 && speakingPage !== current

  // Flatten the packer's per-row sizes back onto the ordered tracks. balancedRows
  // is contiguous, so a single walking index re-pairs sizes with tiles in order.
  const rowTiles = useMemo(() => {
    if (!rows) return null
    let i = 0
    return rows.map((row) => row.map((cell) => ({ tref: shown[i++], ...cell })))
  }, [rows, shown])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col p-2 sm:p-3">
      <div
        ref={ref}
        className="flex min-h-0 flex-1 flex-col content-center items-center justify-center gap-2 sm:gap-3"
      >
        {rowTiles
          ? rowTiles.map((row, ri) => (
              <div key={ri} className="flex shrink-0 justify-center" style={{ gap }}>
                {row.map(({ tref, w, h }) => (
                  <div key={tileKey(tref)} className="min-h-0" style={{ width: w, height: h }}>
                    <Tile trackRef={tref} fill onAspect={(r) => reportAspect(tileKey(tref), r)} />
                  </div>
                ))}
              </div>
            ))
          : shown.map((tref) => (
              <div key={tileKey(tref)} className="min-h-0 aspect-video w-full max-w-3xl">
                <Tile trackRef={tref} fill onAspect={(r) => reportAspect(tileKey(tref), r)} />
              </div>
            ))}
      </div>

      {/* Paged-grid navigation. Arrows live on the left/right EDGES, vertically
          centred (Zoom model) — clear of the top chrome and the floating control
          bar, which a bottom-centre pager collided with. A small page pill +
          off-page-speaker jump sit on the same shelf as the effects carousel
          (above the control bar). */}
      {paged && (
        <>
          <button
            type="button"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="absolute left-1 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-overlay text-white shadow-pop backdrop-blur transition-opacity hover:bg-overlay disabled:pointer-events-none disabled:opacity-0 [&_svg]:size-5"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={current >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="absolute right-1 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-overlay text-white shadow-pop backdrop-blur transition-opacity hover:bg-overlay disabled:pointer-events-none disabled:opacity-0 [&_svg]:size-5"
          >
            <ChevronRightIcon />
          </button>
          <div className="absolute bottom-[max(5.25rem,calc(env(safe-area-inset-bottom)+4.75rem))] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
            <span className="rounded-control bg-overlay px-3 py-1 text-sm font-medium tabular-nums text-white backdrop-blur">
              {current + 1} / {pageCount}
            </span>
            {speakerOffPage && (
              <button
                type="button"
                onClick={() => setPage(speakingPage)}
                className="flex items-center gap-1.5 rounded-control bg-accent px-3 py-1 text-sm font-medium text-accent-ink"
              >
                <SpeakingBars /> Speaking
              </button>
            )}
          </div>
        </>
      )}
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
  // Until dragged, the card keeps its CSS anchor — dodge the docked side panel on
  // desktop (same inset the stage/control bar use) so it never hides behind or
  // overlaps the chat/people panel. Dragging takes over via inline style.
  const panel = useRoomStore((s) => s.panel)
  return (
    <div
      role="group"
      aria-label="Your video — drag to reposition"
      data-no-stage-gesture
      style={style}
      {...handlers}
      className={cn(
        'fixed bottom-24 right-4 z-20 cursor-grab touch-none select-none active:cursor-grabbing',
        'transition-[right] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        panel && 'md:right-[20.5rem] lg:right-[22.5rem] xl:right-[25.5rem]',
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

function Tile({
  trackRef,
  fill = false,
  onAspect,
}: {
  trackRef: TrackReferenceOrPlaceholder
  fill?: boolean
  /** Report the video's real intrinsic aspect (w/h) up to the grid packer. Only
   *  the mixed-orientation grid passes this; spotlight/filmstrip/self ignore it. */
  onAspect?: (ratio: number) => void
}) {
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
      toast(`Couldn't mute ${name}`, 'danger')
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

  // Read the video's intrinsic aspect off the <video> element and report it to the
  // grid packer. 'resize' fires when the publisher rotates their phone mid-call, so
  // the tile re-orients live; rAF retries only until the element mounts.
  const tileRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!onAspect || !hasVideo) return
    const root = tileRef.current
    if (!root) return
    let raf = 0
    let video: HTMLVideoElement | null = null
    const read = () => {
      if (video && video.videoWidth && video.videoHeight) {
        onAspect(video.videoWidth / video.videoHeight)
      }
    }
    const attach = () => {
      const v = root.querySelector('video')
      if (v) {
        video = v
        v.addEventListener('resize', read)
        v.addEventListener('loadedmetadata', read)
        read()
      } else {
        raf = requestAnimationFrame(attach)
      }
    }
    attach()
    return () => {
      cancelAnimationFrame(raf)
      video?.removeEventListener('resize', read)
      video?.removeEventListener('loadedmetadata', read)
    }
  }, [onAspect, hasVideo])

  const ariaLabel = tileLabel({
    name,
    isLocal: p.isLocal,
    myOtherDevice,
    isScreen,
    micOff,
    speaking,
    handRaised,
    hasVideo,
    pinned,
  })

  // Keyboard equivalent of double-tap / long-press to pin (STYLE.md §6: a
  // pointer-only gesture must never be the ONLY way to reach a function). Enter
  // or Space on the focused tile toggles the pin — but only when the tile itself
  // is focused, so a keypress meant for an overlay button (pin/mute/effects)
  // isn't hijacked.
  const onTileKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      togglePin(p.identity)
    }
  }

  return (
    <div
      ref={tileRef}
      // Double-tap (or long-press) a tile to pin it; single tap bubbles
      // to the stage chrome toggle on mobile. Mirrors Zoom/Telegram/Discord.
      // Also a labelled, focusable group so screen-reader + keyboard users get
      // parity with the visual pills and the pointer-only pin gesture.
      role="group"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={onTileKeyDown}
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
        // Visible keyboard focus — the tile is now a tab stop, so it needs its
        // own indicator. Reuse the always-on ring-2 width and recolour it to the
        // accent on focus (overrides the transparent/speaking ring while focused).
        'focus-visible:outline-none focus-visible:ring-[var(--color-accent)]',
      )}
    >
      {hasVideo && pub ? (
        <VideoTrack
          trackRef={trackRef as Parameters<typeof VideoTrack>[0]['trackRef']}
          // Mark the local camera so PiP can pick a remote video off the model,
          // not a fragile CSS-transform check (a remote with any transform used
          // to be wrongly skipped). Set for front AND rear local cam.
          data-local-cam={p.isLocal && !isScreen ? '' : undefined}
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
            // Touch has no hover and a tap doesn't trigger focus-within, so the
            // reveal-on-hover affordance is invisible on phones — pin it visible
            // (and at a 44px target) there. Desktop keeps the hover reveal.
            size={coarse ? 'md' : 'sm'}
            label={`Mute ${name}`}
            icon={<MicOffIcon />}
            className={cn(
              'bg-overlay text-white transition-opacity duration-[var(--dur-fast)] hover:bg-overlay',
              coarse ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
            )}
            onClick={() => void forceMute()}
          />
        )}
        {handRaised && (
          <span aria-hidden className="flex items-center gap-1 rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-warning">
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

      {/* Pin toggle — reveals on hover/focus (desktop). On touch there's no hover
          and the top-right corner is taken by the screen-level participants chip, so
          we rely on double-tap / long-press to pin (taught once by PinCoachmark) plus
          the keyboard Enter/Space path — a persistent button here would collide with
          that chip on the focused fill tile. */}
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

      {/* The tile group's aria-label already names the person + status, so the
          visual name/mic pill is decorative to a screen reader (avoids a double
          read). The connection indicator keeps its own label — it's unique info. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-2">
        <span aria-hidden className="flex items-center gap-1 rounded-control bg-overlay px-2 py-0.5 text-xs font-medium text-white">
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
        <ConnectionQuality participant={p} degradedOnly className="rounded-control bg-overlay p-1" />
      </div>
    </div>
  )
}
