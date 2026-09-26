import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
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
import { Avatar, Button, DropdownItem, DropdownMenu, IconButton, StageChip } from '@/components/primitives'
import {
  CopyIcon,
  CheckIcon,
  EffectsIcon,
  FlipCameraIcon,
  HandIcon,
  MicOffIcon,
  PinIcon,
  ScreenShareIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
  SpotlightIcon,
  GridIcon,
  PeopleIcon,
  AnnotateIcon,
  SpeakerLayoutIcon,
  ChevronDownIcon,
} from '@/components/icons'
import { moderate } from '@/lib/orchestrator'
import { useAppStore } from '@/store/useAppStore'
import { useFlipCamera } from '@/lib/useFlipCamera'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { useHandRaised } from '@/features/reactions/useReactions'
import { useRoomStore } from '@/store/useRoomStore'
import { useBlurControls } from '@/features/effects/BlurContext'
import { useBlockStore } from '@/store/useBlockStore'
import { useShareLink } from '@/lib/useShareLink'
import { DRAG_SLOP, useDraggable } from '@/lib/useDraggable'
import { useChromeHidden, useIslandBand, useRail, useRailBand, useTopBand } from '@/lib/chromeBands'
import { isMyOtherDevice, useMyUserId } from '@/lib/identity'
import { displayNameOf } from '@/lib/participantName'
import { useIsTouch } from '@/lib/useIsTouch'
import { isLocalCam, isScreenShare, primaryShare, shareId, stageFocus, tileKey } from '@/lib/focusTrack'
import { contentLayout, orderUsers, speakerLayout, splitVisible, type StripLayout } from '@/lib/shareLayout'
import { bucketAspect, fitMixedRows, gridCapacity } from '@/lib/tileGrid'
import { dockedStageInset, useViewportWidth } from '@/lib/panelDock'
import { toast } from '@/store/useToastStore'
import { useElementSize } from '@/lib/useElementSize'
import { useChatCompanion, type CompanionLayout } from '@/lib/chatCompanion'
import { useElementFullscreen } from '@/lib/useFullscreen'
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons'
import { AnnotationOverlay } from '@/islands/AnnotationOverlay'
import { TileAction, TileActionStack } from '@/islands/TileActionStack'
import { annotateEnabled } from '@/features/annotate/useAnnotate'
import { useSharePresence } from '@/lib/useSharePresence'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { cn } from '@/lib/cn'

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
 * The stage's width as if no panel were docked — the width tile CAPACITY is
 * decided from, never the width tiles are laid out in.
 *
 * Docking the panel narrows the stage, and deciding capacity from the narrowed
 * width paged people out: at 1024px with 16 in the call, opening chat took the
 * grid from 4 columns to 3, capacity from 16 to 12, and four people to page 2 —
 * not scaled down, gone. Adding the inset back makes the panel a pure "tiles get
 * smaller" operation, which is what the packer (fitMixedRows) is for. It also
 * stops the toggle unmounting and remounting videos it had already decoded.
 */
function useCapacityWidth(measured: number): number {
  const panelOpen = useRoomStore((s) => s.panel) !== null
  const vw = useViewportWidth()
  return measured + (panelOpen ? dockedStageInset(vw) : 0)
}

/**
 * Memoised: Stage takes no props, so the only things that should redraw it are its
 * own subscriptions (tracks, layout, speaking). RoomView re-renders on chat,
 * reactions, the chrome's show/hide and more — none of which the stage shows.
 */
export const Stage = memo(function Stage() {
  const layout = useRoomStore((s) => s.layout)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const demotedShares = useRoomStore((s) => s.demotedShares)
  const stickyShareId = useRoomStore((s) => s.stickyShareId)
  const prunePresentation = useRoomStore((s) => s.prunePresentation)
  const participants = useParticipants()
  const blocked = useBlockStore((s) => s.blocked)
  const visibleTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ).filter((t) => t.participant.isLocal || !blocked.includes(t.participant.identity))
  // `.filter` hands back a NEW array every render, which made every useMemo
  // downstream keyed on `tracks` (the gallery order, the packer's rows…) recompute
  // on EVERY Stage render, whatever caused it. Keep the previous array while it
  // holds the same entries in the same order. Participant and publication are live,
  // mutable LiveKit objects, so a kept entry still reads current state at render
  // time — but two memos downstream read mutable fields and were only ever correct
  // because the array churned: the "videos first" sorts (`hasLiveVideo` →
  // `publication.isMuted`) and the off-page speaker jump (`isSpeaking`). Those two
  // fields ride in the key so those memos still refresh exactly when they must.
  const tracksKey = visibleTracks
    .map(
      (t) =>
        // sid, not just identity: a rejoin under the same name#device is a NEW
        // participant object, and a camera-off placeholder has no trackSid to differ.
        `${t.participant.sid}|${t.participant.identity}|${t.source}|${t.publication?.trackSid ?? ''}|` +
        `${t.publication?.isMuted ? 1 : 0}${t.participant.isSpeaking ? 1 : 0}`,
    )
    .join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content, see above
  const tracks = useMemo(() => visibleTracks, [tracksKey])

  const coarse = useIsTouch()

  const localScreenShare = tracks.find(
    (t) => t.participant.isLocal && t.source === Track.Source.ScreenShare,
  )

  // A presenter SEES their own share, from the moment they start sharing.
  //
  // This used to be hidden — you're already sending it, so echoing it back read as
  // pointless — and arming the pen was what pulled it in, because drawing needs a
  // surface to draw on. That inverted the discovery order: you had to already know
  // annotation existed, and find it on the control bar, before the app would show
  // you the thing you'd be annotating. Presenting now lands directly in the split
  // view (share + everyone else) with an Annotate button on the share itself.
  //
  // It also removes a mid-share LAYOUT SWAP. Arming and disarming used to add and
  // remove a whole region, which is a jarring thing to do underneath a presenter —
  // especially one who is sharing the browser window that's doing the swapping.
  //
  // Two guards. A REMOTE share still wins, so annotating in a room where someone
  // else is presenting targets their screen, not yours.
  //
  // And — the part this comment used to only assert — the echo genuinely does
  // recurse when the captured surface is a whole MONITOR, because the monitor
  // contains this window. That was written down here and never expressed in code:
  // `displaySurface` says which case you're in and nothing read it, so a full-screen
  // share produced a mirror tunnel AND painted the presenter's own captured cursor
  // back under their real one. A window or a non-call tab has nothing to reflect and
  // is unchanged. useSharePresence owns the rule now, because the presenting pill has
  // to agree with the stage about it (and offers the override that flips it).
  const { ownShareShown } = useSharePresence()
  const showOwnShare = Boolean(localScreenShare) && ownShareShown

  const visible =
    localScreenShare && !showOwnShare ? tracks.filter((t) => t !== localScreenShare) : tracks

  // Prune presentation state (demoted-share flags, a person-spotlight) when the active
  // shares or tiles change — a share ended, a spotlighted person left. Keyed on the
  // joined id strings so the effect only fires when the contents actually change, not
  // on every render (the arrays are re-derived each render).
  const shareIdKey = visible
    .filter(isScreenShare)
    .map(shareId)
    .join('|')
  const tileKeyList = visible.map(tileKey).join('|')
  const chatCompanionOn = useChatCompanion().mode !== 'none'
  useEffect(() => {
    prunePresentation(shareIdKey ? shareIdKey.split('|') : [], tileKeyList ? tileKeyList.split('|') : [])
  }, [shareIdKey, tileKeyList, prunePresentation])

  // Alone, with a phone's chat open, the companion strip shows you (TouchStage)
  // rather than the solo screen half-hidden behind the sheet.
  if (participants.length <= 1 && visible.length <= 1 && !(coarse && chatCompanionOn)) {
    return <SoloStage selfTrack={visible[0]} />
  }

  // Which share, if any, owns the big region. Sticky, and it MUST be —
  // useSharePresence picks the featured share the same way to decide where the pen
  // points and which share outgoing ink is addressed to. If this call re-picked on
  // `isSpeaking` while that one held its choice, two presenters taking turns talking
  // would swap the big tile out from under the canvas: ink drawn on the tile you can
  // see, wire-addressed to the one you can't.
  const share = primaryShare(visible, stickyShareId)
  const shareSid = share ? shareId(share) : null
  // Does a share own the stage? ONE condition, both pointer types: someone is
  // sharing, there's more than a share to look at, and this viewer hasn't demoted
  // it. Touch used to ask `featuredShare()` here instead, which also returns
  // undefined when a PERSON is spotlighted — a distinction the phone has no control
  // for, so the two branches were quietly answering different questions off the same
  // data. (The annotation layer still asks featuredShare, via useSharePresence:
  // "is there a surface to draw on" genuinely is the stricter question.)
  const shareLeads =
    share !== undefined && shareSid !== null && visible.length > 1 && !demotedShares.includes(shareSid)

  // ── Touch: the same three views, a different stage ──────────────────────────
  //
  // Everything below this point is the DESKTOP stage. What the two now SHARE is the
  // model — speaker, gallery, content — so `layout` is one value and the View
  // control means the same thing wherever you find it. What they don't share is the
  // rendering, and they shouldn't: a phone has one thumb, an auto-hiding bar and no
  // hover; a desktop has a permanent control bar and the width to keep a filmstrip
  // on screen. Serving both from one branch is what produced a 96px filmstrip with
  // 60px of it underneath the control island.
  if (coarse) {
    return (
      <TouchStage
        visible={visible}
        share={share ?? null}
        shareSid={shareSid}
        shareLeads={shareLeads}
      />
    )
  }

  // Everything from here is DESKTOP-only — the touch branch returned above — which
  // is why none of these three take a `coarse` prop any more. They used to, and it
  // was always false, which is exactly the kind of parameter that quietly grows a
  // second meaning.
  //
  // Content view — the share takes the stage, everyone else rides a filmstrip.
  if (shareLeads && share && shareSid) {
    return <ContentStage visible={visible} share={share} featuredSid={shareSid} />
  }

  // Past that early return, "a share exists" means "and it's demoted" — so it has
  // to become a tile somewhere, whatever the stored layout says. That's what "Show
  // as grid" asked for.
  const shareDemoted = share !== undefined && visible.length > 1

  if (layout === 'grid' || shareDemoted || visible.length <= 1) {
    // "Hide self view" drops your own camera tile from the grid too. Keep it if it's
    // the only tile, so the grid never goes empty.
    const gridTracks =
      selfViewHidden && visible.some((t) => !isLocalCam(t))
        ? visible.filter((t) => !isLocalCam(t))
        : visible
    return <GridStage tracks={gridTracks} />
  }

  return <SpeakerStage visible={visible} />
})

/**
 * Status pill shown to YOU while you're sharing your screen — the in-app counterpart
 * to the browser's "you're sharing" bar. Stop sharing lives on the control bar (the
 * Share button toggles off).
 *
 * Rendered by RoomView inside TopStack, not positioned here: it used to pick a fixed
 * top offset chosen to clear the status chip, which is exactly the guess that breaks
 * the moment a second banner shows up.
 */
export function PresentingIndicator({
  annotating = false,
  sharingMonitor = false,
  ownShareShown = false,
  onToggleOwnShare,
}: {
  annotating?: boolean
  sharingMonitor?: boolean
  ownShareShown?: boolean
  onToggleOwnShare?: () => void
}) {
  return (
    <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-overlay py-1.5 pl-3.5 pr-2 text-sm font-medium text-white shadow-pop backdrop-blur [&_svg]:size-4">
      {annotating ? <AnnotateIcon /> : <ScreenShareIcon />}
      {/* Name the SURFACE, not just the act. The presenter's own stage now looks
          completely different between a window share and a whole-screen one, and an
          unexplained difference reads as a bug. */}
      {annotating
        ? 'You\u2019re drawing on your shared screen'
        : sharingMonitor
          ? 'You\u2019re sharing your entire screen'
          : 'You\u2019re sharing your screen'}
      {/* The escape hatch — and the reason we can be relaxed about browsers that
          report no surface type at all: whatever the app inferred, the presenter
          overrules it in one tap. Wanting to see your own full-screen share is real
          if niche (it is how you would annotate one), so this offers it rather than
          deciding for them. It just is not the DEFAULT, because a mirror tunnel is
          not a thing to hand someone unasked. */}
      {onToggleOwnShare && (
        <button
          type="button"
          onClick={onToggleOwnShare}
          className="rounded-control bg-white/15 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {ownShareShown ? 'Hide my screen' : 'Show my screen'}
        </button>
      )}
    </span>
  )
}

/**
 * Per-publisher frame aspects, learned from the tiles themselves.
 *
 * Meet's "dynamic layouts" model: each tile takes its real frame orientation
 * rather than a viewer-device guess, so a portrait phone feed gets a portrait tile
 * beside a laptop's 16:9 instead of being center-cropped into a shared cell.
 * Unknown / camera-off tiles default to 16:9 so the grid stays calm until a frame
 * lands. Owned by the parent, not by the row renderer, so what we learned about a
 * publisher survives paging away from them and back.
 */
function useTileAspects() {
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const report = useCallback((key: string, ratio: number) => {
    setAspects((prev) => {
      if (prev[key] && Math.abs(prev[key] - ratio) < 0.02) return prev
      return { ...prev, [key]: ratio }
    })
  }, [])
  return { aspects, report }
}

/** The three things a phone stage can be showing. Same model as the desktop, and
 *  deliberately so — `layout` is now one value across both pointer types, so the
 *  View control means the same thing wherever you find it. */
type TouchView = 'speaker' | 'gallery' | 'content'

/**
 * The view switcher — a named chip on the stage, top-left.
 *
 * This replaced a row of page dots, and the swap is the point of the whole touch
 * rework. The dots were 1.5px high and did not read as a control: the only way to
 * discover the gallery was to swipe by accident, and the only way back was to swipe
 * again in a direction nothing advertised. A chip that says "Gallery ⌄" is what
 * Teams, Meet and WhatsApp all put on a phone call, and it answers "what am I
 * looking at" and "how do I change it" in the same 44px.
 *
 * Always visible, not part of the auto-hiding chrome. Same argument the page
 * indicator made and the one thing about it worth keeping: taking away the only
 * route between views, four seconds after the last tap, buys nothing.
 *
 * BOTTOM-left, not top-left, and that is not a taste call. On a phone the focused
 * tile is full-bleed, so every corner of the stage is also a corner of somebody's
 * tile — and the tile's top-left is where its own controls live (the host's
 * force-mute button, the raised-hand badge). A chip there sits exactly on top of
 * them: it swallowed the mute button completely, which the multiparty spec caught
 * by trying to press it. The top-right is taken twice over (StageTopBar's
 * participants chip and the tile's own action stack) and the top-centre is
 * TopStack's. The band above the control island is the one place nothing else
 * claims — it is also the thumb zone, and it is where the dots this replaced were,
 * so it is where people are already looking. It shares that band with the
 * self-view card, which is why both take the same `lift` and sit on opposite sides.
 */
function StageViewSwitcher({
  view,
  hasShare,
  lift = 0,
  onSelect,
}: {
  view: TouchView
  /** Someone is sharing — offer the content view even when it's been demoted. */
  hasShare: boolean
  /** Clearance for the roster strip, matching SelfViewCard's. */
  lift?: number
  onSelect: (v: TouchView) => void
}) {
  const selfCardBottom = useIslandBand(SELF_CARD_GUTTER)
  // A control, so it goes with the rest of the chrome. The self-view card stays:
  // it's you, not a button, and it's what tells you your camera is still on.
  const hidden = useChromeHidden((s) => s.hidden)
  // Sideways there's no bar under it and height is the scarce axis, so it moves up
  // into the top band's empty left end instead of taking a row off the tiles.
  const rail = useRail()
  const meta: Record<TouchView, { label: string; icon: ReactNode }> = {
    speaker: { label: 'Speaker', icon: <SpeakerLayoutIcon /> },
    gallery: { label: 'Gallery', icon: <GridIcon /> },
    content: { label: 'Shared screen', icon: <ScreenShareIcon /> },
  }
  const current = meta[view]
  return (
    // Inside the stage rather than TopStack: that column is one centred stack of
    // status banners, and this is a control anchored to a corner (the same category
    // as StageTopBar's participants chip, at the same layer).
    <div
      className={cn(
        'absolute left-2 z-20 transition-opacity duration-[var(--dur-base)]',
        // A gallery keeps a top band, so the chip sits in it. A single feed or a
        // share fills the stage, and its top-left corner is the tile's own 44px
        // cluster (a host's "Mute <name>", the hand badge) at y 16..60 — a chip
        // parked there took the host's tap. It drops just below that cluster.
        rail &&
          (view === 'gallery'
            ? 'top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))]'
            : 'top-[calc(max(1rem,env(safe-area-inset-top))+3.25rem)]'),
        hidden && 'pointer-events-none opacity-0',
      )}
      // Faded, not removed from the accessibility tree: a screen-reader user can't
      // see the bars go and must still reach it, exactly like the island.
      style={rail ? undefined : { bottom: selfCardBottom + lift }}
      data-no-stage-gesture
    >
      <DropdownMenu
        // Opens away from the edge it's parked on: up from above the bar, down
        // from the top band when the phone is on its side.
        side={rail ? 'bottom' : 'top'}
        align="start"
        trigger={
          <StageChip aria-label={`View: ${current.label}. Change view`}>
            {current.icon}
            {current.label}
            <ChevronDownIcon className="opacity-70" />
          </StageChip>
        }
      >
        {hasShare && (
          <DropdownItem icon={<ScreenShareIcon />} onSelect={() => onSelect('content')}>
            Shared screen
          </DropdownItem>
        )}
        <DropdownItem icon={<SpeakerLayoutIcon />} onSelect={() => onSelect('speaker')}>
          Speaker
        </DropdownItem>
        <DropdownItem icon={<GridIcon />} onSelect={() => onSelect('gallery')}>
          Gallery
        </DropdownItem>
      </DropdownMenu>
    </div>
  )
}

/**
 * The gallery, once everyone stops fitting on one screen: a plain vertical scroll.
 *
 * Paging is what the phone gallery used to do, and paging has one cost that never
 * goes away — the page has to FIT, so tile size is a function of how many people are
 * in the call. Twelve people on a 375px phone meant 2x2 pages of 176px tiles and
 * three swipes to see everyone, and the packer had to re-balance rows every time the
 * roster changed. Scrolling decouples the two: tiles are the same size in a
 * three-person call and a thirty-person one, and reaching person twenty is a flick
 * rather than five taps on a dot row.
 *
 * Mounting thirty <video> elements is the thing paging was really protecting
 * against, and `adaptiveStream` (lib/livekit) already covers it: LiveKit watches
 * each element's visibility and stops the stream for anything scrolled off screen.
 * Paging was solving that problem a second time, in the layout.
 */
function ScrollGallery({
  tracks,
  cols,
  gap,
  cellAspect = 3 / 4,
  extraBottom = 0,
}: {
  tracks: TrackReferenceOrPlaceholder[]
  cols: number
  gap: number
  /** Width/height of a cell. 3:4 unless that would be taller than the stage. */
  cellAspect?: number
  /** More room under the last row (the view chip's band — see VIEW_CHIP_BAND). */
  extraBottom?: number
}) {
  const islandBandPx = useIslandBand() + extraBottom
  const topBand = useTopBand()
  return (
    <div
      // Scrolls INTERNALLY — the page itself never scrolls (see CLAUDE.md). The
      // gesture layer above stays live: a scroll drag fails both the tap test
      // (moves too far) and the swipe test (wrong axis), so nothing double-fires.
      className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain no-scrollbar"
      // Both bands as PADDING, not margin: the first row can still be scrolled up
      // under the timer and the last one down past the island, which is how a
      // scroller should behave — nothing is permanently unreachable, and at rest
      // nothing is hidden.
      style={{ paddingTop: topBand, paddingBottom: islandBandPx }}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
        {tracks.map((t) => (
          // 3:4 cells: touch senders are overwhelmingly portrait phones, and a
          // uniform cell is what makes the scroll calm — a mixed-aspect packer
          // re-flows the whole column every time one person rotates.
          <div key={tileKey(t)} style={{ aspectRatio: cellAspect }}>
            <Tile trackRef={t} fill boxAspect={cellAspect} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The touch stage: three views, one named switcher.
 *
 * This replaced a horizontal PAGE SEQUENCE — page 0 the focus feed, pages 1..n a
 * paged gallery, a row of dots underneath to say where you were. That model was
 * internally coherent (the swipe was the pager AND the mode switch, so the two could
 * never fight) and it still lost, on two counts that only show up on a real phone:
 *
 *  - The dots were the only visible route between views, and a row of 1.5px dots is
 *    not a control. The gallery was reachable only by a swipe nothing advertised.
 *  - A page has to fit, so tile size was a function of headcount. See ScrollGallery.
 *
 * The three views are Teams': SPEAKER (one large feed), GALLERY (everyone, tiled,
 * scrolling past a screenful), CONTENT (a shared screen, with the roster in the
 * slack beside it). `layout` picks between the first two; a live, undemoted share
 * takes precedence and gives you the third — so starting a share still pulls
 * everyone's attention to it without a mode change anyone has to make.
 *
 * Your own camera is a GALLERY CELL in gallery view, and the floating card in the
 * other two. That reverses the earlier rule (a card on every view, a cell in none)
 * and the reasoning is in SelfViewCard: where the stage already tiles people you
 * are one of the tiles — the way every desktop layout carries you, and the way
 * Teams and Meet both tile you on a phone. Where the stage is a single full-bleed
 * feed (speaker, and a share) there is no cell of yours to be in, which is why the
 * card can't simply be deleted along with the rule.
 */
function TouchStage({
  visible,
  share,
  shareSid,
  shareLeads,
}: {
  visible: TrackReferenceOrPlaceholder[]
  /** The primary share, if anyone is sharing — even one this viewer demoted. */
  share: TrackReferenceOrPlaceholder | null
  shareSid: string | null
  /** …and it owns the stage right now (it exists and hasn't been demoted). */
  shareLeads: boolean
}) {
  const islandBandPx = useIslandBand()
  const topBand = useTopBand()
  const railBand = useRailBand()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const pinned = useRoomStore((s) => s.pinned)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const videosFirst = useRoomStore((s) => s.videosFirst)
  const toggleShareDemoted = useRoomStore((s) => s.toggleShareDemoted)
  const { aspects, report: reportAspect } = useTileAspects()
  const { canAnnotate, featuredShareId } = useSharePresence()
  const bigRef = useRef<HTMLDivElement>(null)
  const [bigAspect, setBigAspect] = useState(16 / 9)
  const [rosterOpen, setRosterOpen] = useState(true)

  const localCam = visible.find(isLocalCam)
  const focus = stageFocus(visible, pinned, selfViewHidden)

  // Everyone the gallery tiles — INCLUDING you, and not whichever share is
  // currently full-bleed.
  //
  // You used to be excluded here on the grounds that a cell as well as the floating
  // card would show you to yourself twice. True, and the resolution is the other
  // one: the card stands down where a cell exists (see `showSelfCard`), instead of
  // the gallery having a person-shaped hole in it. `tilePriority` already sorts a
  // local camera to the front, so this needs no special case — you land in the same
  // place you do in the desktop grid, first after any demoted share.
  //
  // `selfViewHidden` drops your cell, exactly as it drops your desktop grid tile.
  //
  // Membership changes only when someone joins or leaves, a share starts or stops
  // leading, or self-view is toggled. Deliberately NOT on speech: the old paged
  // version had to argue this at length because the pager sliced the list by index,
  // so a speaker-driven membership change renumbered everyone and tiles jumped
  // pages mid-sentence. A scroll has no page boundaries to jump across, but a
  // reordering list still moves tiles under a thumb, so the rule stands.
  const gallery = useMemo(() => {
    const rest = visible.filter(
      (t) => !(shareLeads && t === share) && !(isLocalCam(t) && selfViewHidden),
    )
    return [...rest].sort((a, b) => {
      if (videosFirst) {
        const d = Number(hasLiveVideo(b)) - Number(hasLiveVideo(a))
        if (d) return d
      }
      return tilePriority(a) - tilePriority(b) || tileKey(a).localeCompare(tileKey(b))
    })
  }, [visible, share, shareLeads, videosFirst, selfViewHidden])

  // The roster strip beside a share stays everyone-but-you: that view keeps the
  // floating card (the strip is a thumbnail rail, not a gallery, and it collapses),
  // so a cell there would be the double self-view the old rule was guarding against.
  const roster = useMemo(() => gallery.filter((t) => !isLocalCam(t)), [gallery])

  // `roster`, not `gallery`, decides whether the gallery is offered at all: a grid
  // of nobody-but-you is what the speaker view already is, and reading the
  // self-inclusive list here would have quietly made gallery view reachable in a
  // call where every other tile has been filtered away.
  const view: TouchView = shareLeads
    ? 'content'
    : layout === 'grid' && roster.length > 0
      ? 'gallery'
      : 'speaker'

  /**
   * Switching view, including into and out of the share.
   *
   * "Shared screen" un-demotes it and "Speaker"/"Gallery" demote it, because
   * `demotedShares` IS the per-viewer "I don't want this share full-bleed" flag —
   * the same one the tile's own "Show in gallery" button sets. Routing the switcher
   * through it means the chip and that button can't disagree about what you asked
   * for, which two independent flags would eventually do.
   */
  const pickView = (v: TouchView) => {
    if (v === 'content') {
      if (shareSid && !shareLeads) toggleShareDemoted(shareSid)
      setLayout('speaker')
      return
    }
    if (shareLeads && shareSid) toggleShareDemoted(shareSid)
    setLayout(v === 'gallery' ? 'grid' : 'speaker')
  }

  const gap = 8
  // Capacity is measured against the height the tiles actually get (the control
  // island's band is reserved), and against the UNDOCKED width — a phone never
  // docks a panel, but a large touch tablet does, and deciding capacity from the
  // narrowed stage is what used to page people out on every chat toggle.
  // The view chip sits in the band just above the island (portrait, bars showing):
  // a gallery that ran into that band put the chip over the last row's name tag.
  const chromeHidden = useChromeHidden((s) => s.hidden)
  const rail = useRail()
  const chipBand = view === 'gallery' && !chromeHidden && !rail ? VIEW_CHIP_BAND : 0
  const galleryH = Math.max(1, size.height - islandBandPx - chipBand - topBand)
  // The layout DECISION — columns, per page, pack or scroll — is made from the room
  // the tiles have with the bars UP, and holds while they're away. Deciding it from
  // the live bands flipped a 3-4 person gallery between the packed rows and the
  // scroller every time the bars hid or came back: two different trees, so every
  // video remounted (a black flash) and the scroll position reset under the thumb.
  // Only the packed box (TileRows' height) spends the room the bars give back.
  const upIsland = useIslandBand(0, true)
  const upTop = useTopBand(true)
  const upRail = useRailBand(0, true)
  const upChip = view === 'gallery' && !rail ? VIEW_CHIP_BAND : 0
  // `size` is measured inside the rail padding, so give back what the live band took.
  const decideW = Math.max(1, size.width - (view === 'gallery' ? upRail - railBand : 0))
  const decideH = Math.max(1, size.height - upIsland - upChip - upTop)
  const realCap = gridCapacity(decideW, decideH, true)
  const undockedCap = gridCapacity(useCapacityWidth(decideW), decideH, true)
  const cols = realCap.cols
  const perPage = Math.max(realCap.perPage, undockedCap.perPage)
  // Everyone fits → pack them to FILL the stage (three people get big tiles, not
  // three small ones with a void underneath). They don't → uniform scrolling cells.
  const galleryFits = gallery.length <= perPage
  // On a phone held sideways even the legibility floor can leave a 3:4 cell a
  // little taller than the stage; widen the cell just enough that one row always
  // shows whole faces rather than scrolling between halves. Bars-up too, so the
  // scroller's cells don't resize under the thumb as the bars come and go.
  const cellW = (decideW - gap * (cols - 1)) / cols
  const scrollCellAspect = decideH > 1 ? Math.max(3 / 4, cellW / decideH) : 3 / 4

  const stripShowing = view === 'content' && rosterOpen && rosterFits(size, bucketAspect(bigAspect))
  // Lift the self-view clear of the roster strip — they both want the band above the
  // control island, and at 375px a card and an expanded strip landed on top of each
  // other. Same problem the page indicator had, same fix.
  const selfLift = view === 'content' ? (stripShowing ? 90 : 26) : 0
  // The card stands down wherever the stage already shows you: the gallery, which
  // now gives you a cell, and a speaker view whose big tile is you (a call where
  // nobody else has published a camera yet). Two of you on screen at once is the
  // thing to avoid — which cell/card wins is a per-view answer, not a global one.
  const selfIsTiled = view === 'gallery' || (view === 'speaker' && focus === localCam)
  const showSelfCard = Boolean(localCam) && !selfViewHidden && !selfIsTiled

  // A phone with chat open keeps the call in view beside it (lib/chatCompanion).
  // The stage's own view steps out of the way — unmounted, not just covered, so
  // nobody's video decodes twice — but the measured box stays, so its size is
  // current when the chat closes.
  const companion = useChatCompanion()
  const companionOn = companion.mode !== 'none'
  const companionPrimary = shareLeads && share ? share : focus && !isLocalCam(focus) ? focus : roster[0] ?? localCam
  const companionOthers = roster.filter((t) => t !== companionPrimary)

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col p-2"
      // Sideways the controls are a rail on the right, so the tiles give way on
      // that side instead of the bottom. Only the gallery: a single feed or a
      // share stays full-bleed with the rail on glass, as it does with the bar.
      // Not transitioned: the TILES glide (TileRows), and easing the padding as
      // well re-packed them on every frame of it, so they overshot the edge.
      style={view === 'gallery' && railBand ? { paddingRight: railBand } : undefined}
    >
      <div ref={ref} className="relative flex min-h-0 flex-1 flex-col content-center items-center justify-center gap-2">
        {companionOn ? null : view === 'content' && share && shareSid ? (
          <div ref={bigRef} className="relative size-full">
            <Tile
              trackRef={share}
              fill
              boxAspect={size.height > 0 ? size.width / size.height : undefined}
              onAspect={setBigAspect}
              onActivate={() => toggleShareDemoted(shareSid)}
              action={{
                icon: <GridIcon />,
                label: 'Show in gallery',
                onClick: () => toggleShareDemoted(shareSid),
              }}
              actions={
                <>
                  <FullscreenControls targetRef={bigRef} />
                  {annotateEnabled && <AnnotateControl canAnnotate={canAnnotate} />}
                </>
              }
            />
            {annotateEnabled && (
              <AnnotationOverlay
                aspect={bigAspect}
                canAnnotate={canAnnotate}
                featuredShareId={featuredShareId}
              />
            )}
          </div>
        ) : view === 'gallery' ? (
          galleryFits ? (
            // The padded wrapper, rather than padding on the measured element: the
            // initial synchronous measure in useElementSize reads
            // getBoundingClientRect (which includes padding) while its
            // ResizeObserver reads contentRect (which doesn't), so padding the
            // measured box would paint one size and then jump to another.
            <div
              className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2"
              style={{ paddingTop: topBand, paddingBottom: islandBandPx + chipBand }}
            >
              <TileRows
                tracks={gallery}
                width={size.width}
                height={galleryH}
                gap={gap}
                cols={cols}
                aspects={aspects}
                onAspect={reportAspect}
              />
            </div>
          ) : (
            <ScrollGallery
              tracks={gallery}
              cols={cols}
              gap={gap}
              cellAspect={scrollCellAspect}
              extraBottom={chipBand}
            />
          )
        ) : (
          focus && <FocusTile trackRef={focus} />
        )}
      </div>

      {/* The roster strip exists only alongside a share, and only while the share
          doesn't want the height (in portrait a landscape share is width-bound, so
          the space under it is slack rather than a budget). Self is deliberately
          NOT in it — during a share the floating card is still your self-view. */}
      {companionOn && (
        <ChatCompanionStage
          layout={companion}
          primary={companionPrimary}
          others={companionOthers}
          aspects={aspects}
          onAspect={reportAspect}
        />
      )}

      {view === 'content' && !companionOn && (
        <RosterStrip
          tracks={roster}
          open={rosterOpen}
          onToggle={() => setRosterOpen((o) => !o)}
          stageHeight={size.height}
          shareAspect={bucketAspect(bigAspect)}
          stageWidth={size.width}
        />
      )}

      {showSelfCard && localCam && !companionOn && <SelfViewCard trackRef={localCam} lift={selfLift} />}

      {!companionOn && (
        <StageViewSwitcher view={view} hasShare={Boolean(share)} lift={selfLift} onSelect={pickView} />
      )}
    </div>
  )
}

/** The per-tile behaviours a page can override — a share offers "re-present", a
 *  grid tile in the presentation layout offers "spotlight". Named so TileRows'
 *  `tileProps` stays type-checked instead of spreading an untyped bag into Tile. */
type TileOverrides = {
  onActivate?: () => void
  action?: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }
}

/**
 * One page's worth of tiles, packed into justified rows that fill the box.
 *
 * Shared by the desktop paged grid and the touch pager's gallery pages so the two
 * can't drift on packing, gaps or the column cap. Measurement stays with the
 * caller — it owns the box and needs the same numbers to size its page.
 */
function TileRows({
  tracks,
  width,
  height,
  gap,
  cols,
  aspects,
  onAspect,
  tileProps,
}: {
  tracks: TrackReferenceOrPlaceholder[]
  width: number
  height: number
  gap: number
  /** Column cap from gridCapacity — the legibility floor as a count. */
  cols: number
  aspects: Record<string, number>
  onAspect: (key: string, ratio: number) => void
  /** Per-tile extras (activate/action), e.g. "re-present this share". */
  tileProps?: (t: TrackReferenceOrPlaceholder) => TileOverrides
}) {
  const measured = width > 2 && height > 2
  // Touch only: a desktop re-pack follows a window being dragged, where a lag
  // behind the pointer reads as sluggish rather than smooth.
  const glide = useIsTouch()
  // Snap to buckets at pack time (raw ratios stored) so a stream nudging across a
  // boundary doesn't thrash the layout.
  const rows = useMemo(() => {
    if (!measured) return null
    const arr = tracks.map((t) => bucketAspect(aspects[tileKey(t)] ?? 16 / 9))
    return fitMixedRows(width, height, arr, gap, cols)
  }, [measured, tracks, aspects, width, height, gap, cols])

  // Flatten the packer's per-row sizes back onto the ordered tracks. balancedRows
  // is contiguous, so a single walking index re-pairs sizes with tiles in order.
  const rowTiles = useMemo(() => {
    if (!rows) return null
    let i = 0
    return rows.map((row) => row.map((cell) => ({ tref: tracks[i++], ...cell })))
  }, [rows, tracks])

  if (!rowTiles) {
    // Pre-measure fallback: one column of 16:9 boxes. Never a blank stage.
    return (
      <>
        {tracks.map((tref) => (
          <div key={tileKey(tref)} className="min-h-0 aspect-video w-full max-w-3xl">
            <Tile
              trackRef={tref}
              fill
              onAspect={(r) => onAspect(tileKey(tref), r)}
              {...tileProps?.(tref)}
            />
          </div>
        ))}
      </>
    )
  }

  // Every tile placed absolutely inside one box, rather than a flex row per row.
  // Rows used to be separate elements, so a tile the packer moved to another row
  // was a different element: its video unmounted and re-attached, and it jumped.
  // One keyed list of positioned tiles means a re-pack (the touch chrome fading,
  // someone joining, a rotation) is just new coordinates, and on touch they glide
  // there with the same easing the bars slide on.
  let boxH = 0
  const placed: Array<{ tref: TrackReferenceOrPlaceholder; x: number; y: number; w: number; h: number }> = []
  for (const row of rowTiles) {
    const rowW = row.reduce((sum, c) => sum + c.w, 0) + gap * (row.length - 1)
    const rowH = Math.max(0, ...row.map((c) => c.h))
    let x = (width - rowW) / 2
    for (const c of row) {
      placed.push({ tref: c.tref, x, y: boxH + (rowH - c.h) / 2, w: c.w, h: c.h })
      x += c.w + gap
    }
    boxH += rowH + gap
  }
  boxH = Math.max(0, boxH - gap)

  return (
    // `w-full`, not the measured width: that measure lands a frame after a layout
    // change, and a box one frame too wide, centred, threw the first column off
    // the left edge for that frame.
    <div data-tile-rows className="relative w-full shrink-0" style={{ height: boxH }}>
      {placed.map(({ tref, x, y, w, h }) => (
        <div
          key={tileKey(tref)}
          className={cn(
            'absolute',
            glide &&
              'transition-[left,top,width,height] duration-[var(--dur-slow)] ease-[var(--ease-island)] motion-reduce:transition-none',
          )}
          style={{ left: x, top: y, width: w, height: h }}
        >
          <Tile
            trackRef={tref}
            fill
            boxAspect={h > 0 ? w / h : undefined}
            onAspect={(r) => onAspect(tileKey(tref), r)}
            {...tileProps?.(tref)}
          />
        </div>
      ))}
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
function GridStage({ tracks }: { tracks: TrackReferenceOrPlaceholder[] }) {
  const islandBandPx = useIslandBand(TILED_GUTTER)
  const topBand = useTopBand()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [page, setPage] = useState(0)
  const videosFirst = useRoomStore((s) => s.videosFirst)
  const toggleShareDemoted = useRoomStore((s) => s.toggleShareDemoted)

  // A screen share only reaches the grid when the viewer DEMOTED it out of the
  // presentation layout — so give it a one-tap way back (re-present). Cameras get no
  // extra action here (they keep the default pin).
  const shareProps = useCallback(
    (t: TrackReferenceOrPlaceholder) => {
      if (!isScreenShare(t)) return {}
      const promote = () => toggleShareDemoted(shareId(t))
      return {
        onActivate: promote,
        action: { icon: <ScreenShareIcon />, label: 'Present shared screen', onClick: promote },
      }
    },
    [toggleShareDemoted],
  )

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

  // Docking the side panel must not page anybody out. It used to: capacity came
  // from the narrowed stage, so opening chat at 1024px took the page from 20 to 18
  // and at 1200px from 16 to 12 — people gone, not shrunk.
  //
  // The fix is the GREATER of the two capacities, not the undocked one. Narrowing
  // the stage cuts a column, which makes tiles narrower, which makes them SHORTER,
  // which fits more rows — so from ~1279px up the narrowed stage actually holds
  // MORE (12 -> 20 at 1440). Substituting the undocked width would have thrown
  // that away and shown twelve people where twenty fit legibly. Taking the max
  // fixes the direction that loses people and leaves the other alone.
  //
  // The COLUMN CAP is not maxed: it is a legibility floor for the space the tiles
  // actually occupy (tileGrid's fitMixedRows treats it as a ceiling), so it has to
  // follow the real, narrowed width. Panel closed, both widths are equal and none
  // of this does anything.
  const real = gridCapacity(size.width, size.height, false)
  const undocked = gridCapacity(useCapacityWidth(size.width), size.height, false)
  const cols = real.cols
  const perPage = Math.max(real.perPage, undocked.perPage)
  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage))
  // Clamp the page if the count shrank (resize, people left) — keep it in range.
  const current = Math.min(page, pageCount - 1)
  useEffect(() => {
    if (page !== current) setPage(current)
  }, [page, current])
  // Reaching either end disables that arrow, which drops keyboard focus to
  // <body>. After the page changes (both arrows now have their final state),
  // hand focus from a disabled arrow to the other one. A layout effect: the
  // browser's focus fixup moves focus off a disabled element before the next paint.
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const a = document.activeElement
    if (a === prevRef.current && current === 0) nextRef.current?.focus()
    else if (a === nextRef.current && current >= pageCount - 1) prevRef.current?.focus()
  }, [current, pageCount])

  const start = current * perPage
  const shown = ordered.slice(start, start + perPage)
  const paged = pageCount > 1

  const { aspects, report: reportAspect } = useTileAspects()
  const gap = 12

  // If someone is speaking on a page you're not looking at, offer a one-tap jump
  // (no auto-jump — that's jarring). Manual + clearly labelled.
  const speakingPage = useMemo(() => {
    const i = ordered.findIndex((t) => t.participant.isSpeaking)
    return i >= 0 ? Math.floor(i / perPage) : -1
  }, [ordered, perPage])
  const speakerOffPage = paged && speakingPage >= 0 && speakingPage !== current

  return (
    // Both chrome bands reserved — see useIslandBand and useTopBand. This layout
    // had NEITHER: its top row rendered behind the call timer and its bottom row
    // ran underneath the floating control island, at every desktop viewport.
    <div
      className="relative flex min-h-0 flex-1 flex-col px-2 sm:px-3"
      style={{ paddingTop: topBand, paddingBottom: islandBandPx }}
    >
      <div
        ref={ref}
        className="flex min-h-0 flex-1 flex-col content-center items-center justify-center gap-2 sm:gap-3"
      >
        <TileRows
          tracks={shown}
          width={size.width}
          height={size.height}
          gap={gap}
          cols={cols}
          aspects={aspects}
          onAspect={reportAspect}
          tileProps={shareProps}
        />
      </div>

      {/* Paged-grid navigation. Arrows live on the left/right EDGES, vertically
          centred (Zoom model) — clear of the top chrome and the floating control
          bar, which a bottom-centre pager collided with. A small page pill +
          off-page-speaker jump sit on the shelf just above the control bar. */}
      {paged && (
        <>
          <button
            type="button"
            ref={prevRef}
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="absolute left-1 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-overlay text-white shadow-pop backdrop-blur transition-opacity hover:bg-overlay disabled:pointer-events-none disabled:opacity-0 [&_svg]:size-5"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            ref={nextRef}
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


/*
 * How much of the bottom edge the control island claims is `useIslandBand()` — see
 * `lib/chromeBands.ts` for why it's computed per device rather than the flat `76`
 * that used to live here.
 *
 * TILED pages reserve it; the focus page deliberately does NOT — a single feed or a
 * shared screen is full-bleed with the bar on glass, the way a video player works.
 * The distinction matters because a tile's bottom edge carries its name pill, and
 * `SoloStage` was the only layout that had ever reserved anything (`pb-24`), which
 * is how the speaker filmstrip ended up with 60 of its 96px underneath the bar.
 */

/** Breathing room between a tiled layout's last row and the island. */
const TILED_GUTTER = 12

/** Gutter under the floating self-view and the view chip, so they sit just above the
 *  bar rather than flush against it. */
const SELF_CARD_GUTTER = 16

/**
 * What the view chip takes out of a portrait gallery: it sits SELF_CARD_GUTTER above
 * the island and is 44px tall, so a last row has to stop that far up (the stage's own
 * 8px padding supplies the gap). Only while the chip is showing — it fades with the
 * rest of the chrome, and the tiles take the room back.
 */
const VIEW_CHIP_BAND = SELF_CARD_GUTTER + 44

/**
 * Vertical band TopStack's first row occupies: its 16px inset plus a 44px pill plus
 * a gutter.
 *
 * The mirror image of the island band, and it exists for the same reason. The call
 * timer is always up there, centred, and any layout whose content reaches the top
 * edge puts something underneath it: the speaker filmstrip rendered its middle
 * thumbnails behind the timer, and the desktop gallery's top row did the same. A
 * TILED layout reserves this band. A single full-bleed feed or a shared screen
 * deliberately does not — chrome on glass over one big video is the video-player
 * convention, and that content is letterboxed anyway, so the pill lands on a black
 * band rather than on anyone's face.
 *
 * Only the FIRST row is reserved. TopStack's banners (reconnecting, waiting room)
 * are transient and can stack; reserving for every combination would give every
 * layout a permanent empty third. They overlay, as overlays do.
 */
// The number itself, and how it collapses while the touch chrome is hidden, live
// in lib/chromeBands (`useTopBand`) beside the island's band.

/** Strip height on touch — a 3:4 thumbnail wide enough to recognise a face. */
const STRIP_TILE_H = 80
const STRIP_CHROME_H = 34 // grab handle + padding

/**
 * Is there room for the roster strip beside the share?
 *
 * The whole reason the strip can exist: in portrait a landscape share is
 * WIDTH-bound. A 16:9 share paints 359x202 on a 375px phone and cannot be taller
 * whatever we do, so the 449px around it is slack rather than a budget being spent
 * — a strip in it costs the share zero pixels. Which is also the rule for when it
 * appears: gate on the share's PAINTED height, not on orientation and not on
 * headcount. An ultrawide share leaves even more room; a portrait-shaped share (a
 * phone window, a document) leaves almost none; landscape flips the share to
 * height-bound and the room disappears on its own. One derivation, no cases.
 *
 * Exported shape kept tiny so PagedStage can ask the same question — it needs the
 * answer to decide where to put the page indicator.
 */
function rosterFits(size: { width: number; height: number }, shareAspect: number): boolean {
  if (size.width <= 0 || size.height <= 0) return false
  const painted = Math.min(size.height, size.width / Math.max(0.1, shareAspect))
  return size.height - painted >= STRIP_TILE_H + STRIP_CHROME_H
}

/**
 * Collapsible roster alongside a full-bleed share.
 *
 * The reason this can exist at all: in portrait a landscape share is WIDTH-bound.
 * A 16:9 share paints 359x202 on a 375px phone and cannot be taller whatever we do,
 * so the 449px around it is not a design budget being spent — it is slack. A strip
 * in that slack costs the share zero pixels.
 *
 * Which is also the rule for when it appears: it's free for exactly as long as the
 * share doesn't want the height. Gate on the share's PAINTED height, not on
 * orientation and not on headcount — an ultrawide share leaves even more room, a
 * portrait-shaped share (a phone window, a document) leaves almost none, and
 * landscape flips the share to height-bound. One derivation, no special cases.
 *
 * Collapsed state keeps a labelled handle. A roster that can be dismissed with no
 * visible way back is the orphaned-menu bug in a different costume.
 */
function RosterStrip({
  tracks,
  self,
  open,
  onToggle,
  stageWidth,
  stageHeight,
  shareAspect,
}: {
  tracks: TrackReferenceOrPlaceholder[]
  /** Your camera — shown first, because during a share you're a participant like
   *  anyone else and the floating corner card would only cover this. */
  self?: TrackReferenceOrPlaceholder
  /** Controlled by PagedStage, which needs it to place the page indicator. */
  open: boolean
  onToggle: () => void
  stageWidth: number
  stageHeight: number
  shareAspect: number
}) {
  const setPanel = useRoomStore((s) => s.setPanel)
  const expanded = open && rosterFits({ width: stageWidth, height: stageHeight }, shareAspect)

  const ordered = self ? [self, ...tracks.filter((t) => t !== self)] : tracks
  if (ordered.length === 0) return null
  // Cap what mounts. The strip is a glance, not a browse — the pager and the People
  // sheet are for browsing — so a big room ends in a "+N" that opens the roster
  // rather than mounting twenty <video> elements in a scroller.
  const room = Math.max(1, Math.floor((stageWidth - 16 + 6) / (STRIP_TILE_H * 0.75 + 6)))
  const shown = ordered.slice(0, ordered.length > room ? Math.max(1, room - 1) : room)
  const overflow = ordered.length - shown.length

  return (
    <div
      // The strip scrolls horizontally, which is the same axis the stage pages on —
      // without this a flick through the roster would also turn the page.
      data-no-stage-gesture
      className="pointer-events-none absolute inset-x-0 bottom-[max(4.5rem,calc(env(safe-area-inset-bottom)+4rem))] z-10"
    >
      <div className="pointer-events-auto mx-auto rounded-t-island bg-overlay pb-2 pt-1.5 backdrop-blur">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full flex-col items-center gap-1 px-3 pb-1"
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-white/35" />
          {!expanded && (
            <span className="flex items-center gap-1.5 pt-0.5 text-[11.5px] font-medium text-white/85 [&_svg]:size-3.5">
              <PeopleIcon />
              {ordered.length} {ordered.length === 1 ? 'person' : 'people'}
            </span>
          )}
          <span className="sr-only">{expanded ? 'Hide people' : 'Show people'}</span>
        </button>
        {expanded && (
          <div className="flex gap-1.5 overflow-x-auto px-2 no-scrollbar">
            {shown.map((t) => (
              <div
                key={tileKey(t)}
                data-no-stage-gesture
                className={cn(
                  'shrink-0 overflow-hidden rounded-tile',
                  t === self && 'ring-2 ring-accent ring-inset',
                )}
                style={{ height: STRIP_TILE_H, width: STRIP_TILE_H * 0.75 }}
              >
                <Tile trackRef={t} fill />
              </div>
            ))}
            {overflow > 0 && (
              <div className="shrink-0" style={{ height: STRIP_TILE_H, width: STRIP_TILE_H * 0.75 }}>
                <OverflowTile count={overflow} onClick={() => setPanel('people')} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The call beside a phone's open chat (lib/chatCompanion) — so chatting doesn't
 * mean losing sight of the people you're chatting with.
 *
 * Both ways it shows whoever is talking, in their true shape, in the room the
 * panel leaves: the top half upright (the sheet takes the bottom half), the left
 * side sideways. A wide speaker fills the width and everyone else is a "+N" chip
 * (two wide tiles won't stack). A tall speaker is a column, which leaves room
 * beside it, so the next two people fill that instead of empty space.
 *
 * Upright used to be a 180px row of thumbnails with the sheet taking the rest;
 * see lib/chatCompanion for why it became half and half.
 *
 * You're left out unless there's nobody else: your own face is what the chat
 * doesn't need. A share, when it leads the stage, leads here too.
 */
function ChatCompanionStage({
  layout,
  primary,
  others,
  aspects,
  onAspect,
}: {
  layout: Exclude<CompanionLayout, { mode: 'none' }>
  primary: TrackReferenceOrPlaceholder | undefined
  others: TrackReferenceOrPlaceholder[]
  aspects: Record<string, number>
  onAspect: (key: string, ratio: number) => void
}) {
  const aspectOf = (t: TrackReferenceOrPlaceholder) => aspects[tileKey(t)] ?? 16 / 9
  const tile = (t: TrackReferenceOrPlaceholder, box: number) => (
    <Tile trackRef={t} fill boxAspect={box} onAspect={(r) => onAspect(tileKey(t), r)} />
  )
  // Everyone in the call, you included — "+3 in the call" beside one speaker in a
  // call of four.
  const headcount = useParticipants().length

  if (layout.mode === 'top' && !layout.stageShown) return null
  return (
    <CompanionBox
      placement={layout.mode}
      style={
        layout.mode === 'top'
          ? { top: layout.stageTop, height: layout.stageH }
          : { right: layout.panelW + 8 }
      }
      primary={primary}
      others={others}
      people={headcount}
      aspectOf={aspectOf}
      tile={tile}
    />
  )
}

/** The room the panel leaves: the top half upright, the left side sideways. Its
 *  own component so it measures its box on mount — a phone turned while chatting
 *  arrives here from the other placement. */
function CompanionBox({
  placement,
  style,
  primary,
  others,
  people,
  aspectOf,
  tile,
}: {
  placement: 'top' | 'side'
  style: CSSProperties
  primary: TrackReferenceOrPlaceholder | undefined
  others: TrackReferenceOrPlaceholder[]
  people: number
  aspectOf: (t: TrackReferenceOrPlaceholder) => number
  tile: (t: TrackReferenceOrPlaceholder, box: number) => ReactNode
}) {
  const setPanel = useRoomStore((s) => s.setPanel)
  const bottomBand = useIslandBand()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const gap = 8
  const chipH = 32
  const aw = size.width
  const ah = size.height
  const a = primary ? aspectOf(primary) : 16 / 9
  const tall = a < 1
  const beside = tall ? others.slice(0, 2) : []
  const rest = Math.max(0, people - 1 - beside.length)
  let bigW = 0
  let bigH = 0
  let sideW = 0
  if (aw > 0 && ah > 0) {
    if (tall) {
      bigH = ah
      bigW = Math.min(bigH * Math.max(9 / 16, a), beside.length ? aw * 0.6 : aw)
      bigH = bigW / Math.max(9 / 16, a)
      sideW = beside.length ? aw - bigW - gap : 0
    } else {
      // The "+N" chip floats on the video's corner, so the video gets the whole box.
      bigW = Math.min(aw, ah * a)
      bigH = bigW / a
    }
  }
  const smallH = beside.length ? Math.min((ah - (rest > 0 ? chipH + gap : 0) - gap * (beside.length - 1)) / beside.length, sideW * 0.75) : 0
  const chip = rest > 0 && (
    <button
      type="button"
      onClick={() => setPanel('people')}
      className="h-8 shrink-0 self-center rounded-full bg-overlay px-3 text-sm font-medium text-white backdrop-blur"
    >
      +{rest} in the call
    </button>
  )
  return (
    <div
      ref={ref}
      data-no-stage-gesture
      data-chat-companion={placement}
      role="group"
      aria-label="People in the call"
      className={cn(
        'absolute z-10',
        placement === 'top'
          ? 'inset-x-2'
          : 'left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))]',
      )}
      style={placement === 'top' ? style : { ...style, bottom: bottomBand }}
    >
      {primary && bigW > 0 && (
        <div className="flex size-full items-center justify-center" style={{ gap }}>
          {tall ? (
            <>
              <div className="shrink-0" style={{ width: bigW, height: bigH }}>
                {tile(primary, bigW / bigH)}
              </div>
              {beside.length > 0 && (
                <div className="flex shrink-0 flex-col justify-center" style={{ width: sideW, gap }}>
                  {beside.map((t) => (
                    <div key={tileKey(t)} style={{ height: smallH }}>
                      {tile(t, sideW / smallH)}
                    </div>
                  ))}
                  {chip}
                </div>
              )}
            </>
          ) : (
            <div className="relative" style={{ width: bigW, height: bigH }}>
              {tile(primary, a)}
              {chip && <div className="absolute right-2 bottom-2 z-10 flex">{chip}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Display name for a tile's participant (strips the `#deviceId` identity suffix). */
function tileName(t: TrackReferenceOrPlaceholder): string {
  return displayNameOf(t.participant.identity, t.participant.name, '')
}

/** Enter/exit-fullscreen controls overlaid on the shared-screen big tile. On desktop
 *  Esc also exits (native); on touch there's no Esc, so the floating Exit button is the
 *  way out. Enter sits top-left (clear of the top-right action + bottom name pill). */
function FullscreenControls({ targetRef }: { targetRef: { current: HTMLElement | null } }) {
  const { isFs, enter, exit } = useElementFullscreen(targetRef)
  // Enter is an ordinary row in the tile's action stack. Exit is NOT: in fullscreen
  // it is deliberately the only control that should exist, so it keeps its own
  // anchor and its own layer (z-30, above the stack) rather than queueing politely
  // behind buttons that are meaningless there.
  if (isFs) {
    return (
      <div className="absolute right-2 top-2 z-30" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton
          size="md"
          label="Exit full screen"
          icon={<ExitFullscreenIcon />}
          tone="overlay"
          onClick={exit}
        />
      </div>
    )
  }
  return (
    <TileAction>
      <IconButton
        size="sm"
        label="View shared screen full screen"
        icon={<FullscreenIcon />}
        tone="overlay"
        onClick={enter}
      />
    </TileAction>
  )
}

/**
 * Annotate toggle pinned to the shared-screen tile.
 *
 * The control bar keeps its own copy (it's the keyboard-reachable one, and it sits
 * with the other call controls), but the pen belongs on the surface it draws on:
 * a presenter who has just started sharing is looking AT the share, not scanning a
 * bar for a feature they may not know exists. Stacks under the fullscreen button in
 * the same top-right column.
 *
 * Hidden on touch, matching the pen itself — drawing has to capture touch, which
 * fights the control bar's tap-to-reveal. Touch devices still see everyone's ink.
 */
function AnnotateControl({ canAnnotate }: { canAnnotate: boolean }) {
  const active = useAnnotateStore((s) => s.active)
  const toggle = useAnnotateStore((s) => s.toggle)
  // `canAnnotate` arrives as a prop rather than from useSharePresence here: it is
  // still the same single condition the control bar's pen renders on, but this
  // subtree resolves it ONCE (in PresentationStage) instead of subscribing three
  // separate components to the track list. See AnnotationOverlay's header.
  if (!canAnnotate) return null
  return (
    <TileAction>
      <IconButton
        size="sm"
        // Deliberately NOT the control bar's wording. Both controls drive the same
        // pen, and two buttons sharing one accessible name is ambiguous to a screen
        // reader (and to anyone scripting the page) — name them by where they are.
        label={active ? 'Stop drawing on the shared screen' : 'Draw on the shared screen'}
        icon={<AnnotateIcon />}
        active={active}
        tone="overlay"
        className="shadow-pop"
        onClick={toggle}
      />
    </TileAction>
  )
}

/** Grid-tile-shaped shortcut to the full roster (the "+N view all" overflow). */
function OverflowTile({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-full place-items-center rounded-tile bg-sunken text-ink ring-1 ring-line transition-colors hover:bg-line [&_svg]:size-5"
      aria-label={`View all people (${count} more)`}
    >
      <span className="flex flex-col items-center gap-1 text-sm font-medium">
        <PeopleIcon />
        <span className="tabular-nums">+{count}</span>
      </span>
    </button>
  )
}

/**
 * A filmstrip of thumbnails — the shared rendering half of speaker and content
 * view. Geometry (side, box, tile size, how many fit) is decided by lib/shareLayout
 * and handed in; this only lays the tiles out and puts the "+N" overflow in the
 * last slot when there are more people than slots.
 *
 * One component rather than two so the two views can't drift on tile shape, gap or
 * overflow behaviour — the same reason TileRows is shared by the galleries.
 */
function Filmstrip({
  layout,
  tracks,
  gap,
  onOverflow,
  tileProps,
}: {
  layout: StripLayout
  /** Already ordered and already sliced to `layout.capacity` by the caller. */
  tracks: TrackReferenceOrPlaceholder[]
  gap: number
  /** How many people didn't fit; renders the "+N" tile when > 0. */
  onOverflow: { count: number; onClick: () => void }
  tileProps?: (t: TrackReferenceOrPlaceholder) => TileOverrides
}) {
  if (layout.capacity <= 0) return null
  const vertical = layout.side === 'right'
  return (
    <div
      // Scrolls along its own axis, and the stage's gesture layer must not read
      // that as a stage gesture.
      data-no-stage-gesture
      className={cn(
        'absolute flex overflow-hidden',
        vertical ? 'flex-col' : 'flex-row justify-center',
      )}
      style={{ left: layout.strip.x, top: layout.strip.y, width: layout.strip.w, height: layout.strip.h, gap }}
    >
      {tracks.map((t) => (
        <div key={tileKey(t)} className="shrink-0" style={{ width: layout.tile.w, height: layout.tile.h }}>
          <Tile trackRef={t} fill boxAspect={layout.tile.w / layout.tile.h} {...tileProps?.(t)} />
        </div>
      ))}
      {onOverflow.count > 0 && (
        <div className="shrink-0" style={{ width: layout.tile.w, height: layout.tile.h }}>
          <OverflowTile count={onOverflow.count} onClick={onOverflow.onClick} />
        </div>
      )}
    </div>
  )
}

/**
 * Speaker view (desktop) — one large feed, everyone else along the TOP.
 *
 * The strip is at the top and that is the load-bearing part. It used to be a
 * `h-24` row at the bottom of a column with `pb-[5.5rem]` reserved under it, and in
 * a three-person call it still came out with more than half its height underneath
 * the floating control island: the reserved band and the strip height were picked
 * independently, by different people, and nothing ever checked they added up. A
 * strip along the top cannot collide with a bar along the bottom at any viewport,
 * with no arithmetic to get wrong. It's also where Teams puts it.
 *
 * You are IN the strip here, like everyone else — there is no floating self-view on
 * desktop any more (see SelfViewCard). The old layout excluded you from the strip
 * and then floated a second copy of you over the stage instead.
 */
function SpeakerStage({ visible }: { visible: TrackReferenceOrPlaceholder[] }) {
  const islandBandPx = useIslandBand(TILED_GUTTER)
  const topBand = useTopBand()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const pinned = useRoomStore((s) => s.pinned)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const setPanel = useRoomStore((s) => s.setPanel)

  // Pin wins — including a pin on yourself — then the active speaker, then your own
  // camera so the big region is never empty. See stageFocus.
  const focus = stageFocus(visible, pinned, selfViewHidden)

  let rest = visible.filter((t) => t !== focus)
  if (selfViewHidden) rest = rest.filter((t) => !isLocalCam(t))
  const ordered = orderUsers(rest, hasLiveVideo, tileKey)

  const gap = 12
  const L = speakerLayout(size.width, size.height, ordered.length, gap)
  const { shown, overflow } = splitVisible(ordered, L.capacity)

  return (
    // Both bands reserved. The bottom one keeps the big tile off the control
    // island; the top one keeps the FILMSTRIP off the call timer, which is centred
    // up there and was landing squarely on the middle thumbnails.
    <div
      className="relative flex min-h-0 flex-1 px-2 sm:px-3"
      style={{ paddingTop: topBand, paddingBottom: islandBandPx }}
    >
      <div ref={ref} className="relative min-h-0 flex-1">
        {size.width > 2 && size.height > 2 && (
          <>
            <Filmstrip
              layout={L}
              tracks={shown}
              gap={gap}
              onOverflow={{ count: overflow, onClick: () => setPanel('people') }}
            />
            <div
              className="absolute"
              style={{ left: L.big.x, top: L.big.y, width: L.big.w, height: L.big.h }}
            >
              {focus && <FocusTile trackRef={focus} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Content view — a shared screen owns the stage (Teams' content layout).
 *
 * The share takes a region of fixed shape and everyone else rides a filmstrip
 * beside it: a right-hand rail on a landscape stage, a bottom strip on a portrait
 * one. lib/shareLayout has the argument for a FIXED strip in full; the short version
 * is that the adaptive split this replaced sized the big region to the content's own
 * aspect and clamped it to 85% of the stage, so a 16:9 share on a 16:9 monitor got
 * letterboxed to make room for a 15% band of tiles too short to recognise anyone in.
 * Both regions lost, and which one lost more depended on what the presenter happened
 * to have on screen.
 *
 * A right rail costs the share almost nothing, which is the other half of the
 * decision: a landscape share on a landscape stage is HEIGHT-bound, so width is the
 * slack. (On a portrait stage it's the reverse, and the strip goes to the bottom —
 * the same observation `rosterFits` makes for the phone.)
 *
 * Any tile can take the big slot: clicking a person spotlights them and the share
 * moves into the strip.
 */
function ContentStage({
  visible,
  share,
  featuredSid,
}: {
  visible: TrackReferenceOrPlaceholder[]
  share: TrackReferenceOrPlaceholder
  /** Track SID of the featured share — presentation state (demote) is keyed on it. */
  featuredSid: string
}) {
  const islandBandPx = useIslandBand(TILED_GUTTER)
  const topBand = useTopBand()
  const { ref, size } = useElementSize<HTMLDivElement>()
  const spotlightKey = useRoomStore((s) => s.spotlightKey)
  const setSpotlight = useRoomStore((s) => s.setSpotlight)
  const toggleShareDemoted = useRoomStore((s) => s.toggleShareDemoted)
  const selfViewHidden = useRoomStore((s) => s.selfViewHidden)
  const setPanel = useRoomStore((s) => s.setPanel)
  const [bigAspect, setBigAspect] = useState(16 / 9)
  const bigRef = useRef<HTMLDivElement>(null)
  // Resolved once here and passed down. useSharePresence is backed by useTracks,
  // so every component that calls it re-renders on room traffic — which is fine
  // for a button and ruinous for the ink layer (see AnnotationOverlay's header).
  const { canAnnotate, featuredShareId } = useSharePresence()

  // The big tile: an explicit spotlight (person-swap) or, by default, the share.
  const big = visible.find((t) => tileKey(t) === spotlightKey) ?? share
  const bigIsShare = isScreenShare(big)

  // Strip = everyone except the big tile; drop self if hidden (unless it'd empty it).
  let rest = visible.filter((t) => t !== big)
  if (selfViewHidden && rest.some((t) => !isLocalCam(t))) rest = rest.filter((t) => !isLocalCam(t))
  const ordered = orderUsers(rest, hasLiveVideo, tileKey)

  const gap = 12
  const measured = size.width > 2 && size.height > 2
  // No undocked-width correction here, unlike the galleries. A right-hand rail's
  // capacity is decided by HEIGHT, which docking the chat panel doesn't touch — so
  // the "opening chat pages people out" failure the galleries have to defend
  // against cannot arise in the layout that this view actually uses on a desktop.
  // The rail is inset from the top for the participants chip, which lives in that
  // same corner and was sitting on the first thumbnail. The SHARE keeps its full
  // height — that is the entire argument for a right-hand rail, so paying for the
  // chip out of the share's height instead would give the rail back with one hand
  // and take the content with the other.
  const L = contentLayout(size.width, size.height, ordered.length, gap, topBand)
  const { shown, overflow } = splitVisible(ordered, L.capacity)

  /** Tapping a person in the strip spotlights them; tapping the share re-features it. */
  const stripProps = (t: TrackReferenceOrPlaceholder): TileOverrides =>
    isScreenShare(t)
      ? {
          onActivate: () => setSpotlight(null),
          action: { icon: <ScreenShareIcon />, label: 'Show shared screen', onClick: () => setSpotlight(null) },
        }
      : {
          onActivate: () => setSpotlight(tileKey(t)),
          action: {
            icon: <SpotlightIcon />,
            label: `Spotlight ${tileName(t)}`,
            onClick: () => setSpotlight(tileKey(t)),
          },
        }

  return (
    <div className="relative flex min-h-0 flex-1 p-2 sm:p-3" style={{ paddingBottom: islandBandPx }}>
      <div ref={ref} className="relative min-h-0 flex-1">
        {measured && (
          <>
            {/* Big region — the share (object-contain, never cropped) or a spotlit person. */}
            <div className="absolute" style={{ left: L.big.x, top: L.big.y, width: L.big.w, height: L.big.h }}>
              <div ref={bigRef} className="relative size-full">
                <Tile
                  trackRef={big}
                  fill
                  boxAspect={L.big.h > 0 ? L.big.w / L.big.h : undefined}
                  onAspect={setBigAspect}
                  onActivate={() => (bigIsShare ? toggleShareDemoted(featuredSid) : setSpotlight(null))}
                  action={
                    bigIsShare
                      ? { icon: <GridIcon />, label: 'Show in gallery', onClick: () => toggleShareDemoted(featuredSid) }
                      : { icon: <ScreenShareIcon />, label: 'Back to shared screen', onClick: () => setSpotlight(null) }
                  }
                  actions={
                    bigIsShare && (
                      <>
                        <FullscreenControls targetRef={bigRef} />
                        {annotateEnabled && <AnnotateControl canAnnotate={canAnnotate} />}
                      </>
                    )
                  }
                />
                {/* Ink layer for the shared screen. Inside bigRef so it follows the
                    share into fullscreen; owns its own canvas and never re-renders
                    the stage while drawing. */}
                {bigIsShare && annotateEnabled && (
                  <AnnotationOverlay
                    aspect={bigAspect}
                    canAnnotate={canAnnotate}
                    featuredShareId={featuredShareId}
                  />
                )}
              </div>
            </div>

            <Filmstrip
              layout={L}
              tracks={shown}
              gap={gap}
              onOverflow={{ count: overflow, onClick: () => setPanel('people') }}
              tileProps={stripProps}
            />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The speaker layout's big tile, measured.
 *
 * Unlike the grid — where the packer already sizes each cell to its publisher —
 * this tile just inherits whatever the stage's shape is, so nothing upstream knows
 * whether the video about to land in it is a wild mismatch. This is where a phone
 * in a 1-on-1 puts a laptop's 16:9 camera into a tall box, and the reason the feed
 * arrived cropped to a portrait sliver. Measuring here hands Tile the box shape it
 * needs to decide (see MAX_CROP_RATIO). One observer, on one element.
 */
function FocusTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  return (
    <div ref={ref} className="size-full">
      <Tile
        trackRef={trackRef}
        fill
        boxAspect={size.width > 0 && size.height > 0 ? size.width / size.height : undefined}
      />
    </div>
  )
}

/** Alone in the call: show your own camera (like Teams/Meet) + an invite hint. */
function SoloStage({ selfTrack }: { selfTrack?: TrackReferenceOrPlaceholder }) {
  const { copied, copy } = useShareLink()
  const coarse = useIsTouch()
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-2 pb-24 sm:gap-5 sm:p-4 sm:pb-28',
        // (`short` too: a phone, not a tablet, whose landscape has height to spare.)
        // A phone on its side is ~360px tall: a card stacked over the invite
        // overflowed it, and `justify-center` split the overflow so the top of
        // your own video went off-screen. Side by side instead, card sized by
        // the height it actually has.
        coarse && 'landscape:short:flex-row landscape:short:gap-6 landscape:short:pt-4 landscape:short:pb-24',
      )}
    >
      {/* Touch (phones): a tall portrait card that fills the available height
          (Meet/Gmail self-view), invite below. Desktop (mouse): a constrained
          landscape card — full height would waste the wide canvas. */}
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-tile',
          // Touch: a tall portrait card, but height-capped so the invite below
          // stays on-screen (flex-1 ate the whole viewport and pushed it off).
          coarse
            ? 'aspect-[3/4] w-full max-w-[18rem] max-h-[55dvh] landscape:short:h-full landscape:short:max-h-none landscape:short:w-auto landscape:short:max-w-none'
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
      <div className={cn('shrink-0 text-center', coarse && 'landscape:short:text-left')}>
        <p className="text-sm font-medium">You’re the only one here</p>
        <p className="mt-1 text-xs text-ink-muted">Invite someone to join this call.</p>
        <Button variant="accent" className="mt-3" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Link copied' : 'Copy invite link'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Your own camera, floating over the stage. Starts bottom-right and snaps to
 * whichever corner you drag it nearest (Meet / Teams / Discord).
 *
 * TOUCH-ONLY, and big — those two decisions are the same decision.
 *
 * On a phone this is the only place you see yourself in the two views that have no
 * cell for you: SPEAKER, which is one full-bleed feed, and a share, whose roster
 * strip is a collapsible thumbnail rail rather than a gallery. (The gallery does
 * give you a cell, and the card stands down there — TouchStage's `showSelfCard`.
 * Two of you on screen at once is what both halves of that rule are avoiding.)
 *
 * So where it does render, the card is not a courtesy thumbnail, it is your entire
 * self-view — and it was 96px wide, too small to tell whether you were in frame,
 * which is the one question a self-view exists to answer. It is now a third of the
 * viewport, and a tap opens it to ~62% for a proper look before it goes back to
 * staying out of the way.
 *
 * Desktop doesn't render it at all any more. Every desktop layout already carries
 * you as a real tile — a gallery cell, or a filmstrip thumbnail in speaker/content
 * view — so the card was a second, smaller copy of a tile you already had, parked on
 * top of the stage. That is not what Teams does on a wide screen and it isn't what
 * the space calls for.
 *
 * `reserveBottom` keeps the control island's band out of the draggable area, so the
 * card can't be parked where it's neither visible nor reachable — 76px is the
 * island's 60px height plus its 16px inset. The CSS anchor below matches, so the
 * un-dragged position and the snapped bottom-right position are the same place.
 */
function SelfViewCard({ trackRef, lift = 0 }: { trackRef: TrackReferenceOrPlaceholder; lift?: number }) {
  const islandBandPx = useIslandBand()
  const selfCardBottom = useIslandBand(SELF_CARD_GUTTER)
  const upCardBottom = useIslandBand(SELF_CARD_GUTTER, true)
  const upTop = useTopBand(true)
  // Sideways, the controls are a rail down the right edge: the card parks beside it.
  const railBand = useRailBand()
  // Extra clearance for whatever else is claiming the band above the island (the
  // roster strip, during a share). It moves the CSS anchor and the drag floor
  // together — those two disagreeing is how the card ended up parked underneath
  // the control island in the first place.
  const { style, handlers } = useDraggable(16, { initial: 'br', reserveBottom: islandBandPx + lift, reserveRight: railBand })
  const [expanded, setExpanded] = useState(false)
  // Tap to expand, drag to move — one pointer, two gestures, so the tap has to be
  // told apart from the drag. useDraggable's own 6px threshold decides whether a
  // gesture MOVED the card; this only has to not fire when it did, which the same
  // threshold answers. Measured here rather than exposed from the hook because the
  // hook's `moved` flag is consumed (and reset) by its own pointerup.
  const down = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      role="group"
      aria-label="Your video — drag to reposition"
      data-no-stage-gesture
      style={{
        bottom: selfCardBottom + lift,
        ...(railBand ? { right: railBand + 16 } : {}),
        // Width from the viewport's WIDTH alone made a 3:4 card taller than a phone
        // on its side (expanded: 427px on a 390px screen), so its top went off the
        // screen. Also cap it by the height actually left between the island's band
        // (measured, safe area included) and the TopStack band above.
        // Sized from the bars-UP bands, so the card keeps its size as the bars come
        // and go (only its position follows them) and never grows past the room it
        // will have once they're back.
        maxWidth: `min(${expanded ? '20rem' : '11rem'}, calc((100dvh - ${upCardBottom + lift + upTop}px) * 0.75))`,
        ...style,
      }}
      {...handlers}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
        handlers.onPointerDown(e)
      }}
      onPointerUp={(e) => {
        const d = down.current
        down.current = null
        handlers.onPointerUp(e)
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_SLOP) setExpanded((v) => !v)
      }}
      className={cn(
        'fixed right-4 z-20',
        'cursor-grab touch-none select-none active:cursor-grabbing',
        'transition-[right,width] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        // A tall portrait card (Discord/Snapchat self-view), sized off the VIEWPORT
        // so it reads the same on a 320px phone and a 430px one. Expanded is a look
        // at yourself; collapsed is a glance that leaves the call visible behind it.
        'aspect-[3/4] overflow-hidden rounded-tile shadow-raised ring-1 ring-white/10',
        // (The height cap is the inline maxWidth above.)
        expanded ? 'w-[62vw]' : 'w-[33vw]',
      )}
    >
      {/* No `boxAspect`: this crops to fill rather than letterboxing. A phone
          camera is already 3:4 so it makes no difference there, but a tablet held
          in landscape would otherwise show your face in a small band between two
          black bars — and in a card this size, bars cost more than a crop does
          (the rule Tile documents for thumbnails). */}
      <Tile trackRef={trackRef} fill />
      <span className="sr-only">{expanded ? 'Tap to shrink your video' : 'Tap to enlarge your video'}</span>
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

/**
 * Beyond this much disagreement between a camera's shape and the box it lands in,
 * the tile letterboxes instead of cropping.
 *
 * `object-cover` is the right default — it fills, and a tile whose box already
 * matches its source loses nothing to it. But the box does NOT always match: a
 * phone showing a laptop's 16:9 feed in a tall focus tile crops away most of the
 * frame's width, which is how a call ends up hiding whoever is sitting off to the
 * side. Past this ratio the crop costs more than the black bars do.
 *
 * 1.4 is picked to split the two real cases apart: landscape-into-portrait (16:9
 * in a 3:4 box = 2.37) letterboxes, while the modest mismatches that come from
 * bucketed grid cells (9:16 in a 3:4 box = 1.33) keep filling the tile. Phone-to-
 * phone calls therefore look exactly as they do today.
 */
const MAX_CROP_RATIO = 1.4
const badlyCropped = (video: number, box: number) =>
  Math.max(video, box) / Math.min(video, box) > MAX_CROP_RATIO

function Tile({
  trackRef,
  fill = false,
  onAspect,
  boxAspect,
  onActivate,
  action,
  actions,
}: {
  trackRef: TrackReferenceOrPlaceholder
  fill?: boolean
  /** Report the video's real intrinsic aspect (w/h) up to the grid packer. Only
   *  the mixed-orientation grid passes this; spotlight/filmstrip/self ignore it. */
  onAspect?: (ratio: number) => void
  /** The tile box's own w/h, when the caller knows it. Supplying it opts the tile
   *  into letterboxing a badly-mismatched camera (see MAX_CROP_RATIO) instead of
   *  cropping it. Omitted for small thumbnails (filmstrip, self-view), where bars
   *  cost more than a crop does. */
  boxAspect?: number
  /** Override the double-tap / long-press / Enter gesture. Presentation uses this to
   *  spotlight (grid tile) or demote (big tile) instead of the default pin toggle. */
  onActivate?: () => void
  /** Replace the corner pin button with a custom action (icon + label). Presentation
   *  shows spotlight / exit-presentation here instead of pin. */
  action?: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }
  /** Extra rows for the tile's top-right action stack (fullscreen, annotate). They
   *  render as siblings of the tile's own action button, spaced by the stack — no
   *  caller picks an offset. */
  actions?: ReactNode
}) {
  const p = trackRef.participant
  const name = displayNameOf(p.identity, p.name, '')
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
      toast(`Couldn’t mute ${name} — try again`, 'danger')
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

  // Self-view tile controls (flip camera / blur) live ON the tile now, like
  // WhatsApp/Snapchat — keeps them off the control bar. Touch only (desktop uses
  // the device picker + the More menu).
  //
  // Blur is a DIRECT toggle. It used to open a "lens carousel" above the control
  // bar, which was a horizontal scroller built for a gallery of effects that no
  // longer exists: image backgrounds were removed for repeatedly breaking the
  // feed, leaving a two-item strip (None / Blur) that cost a tap to open, a tap to
  // pick, its own overlay layer, a mirrored store, and a chrome-hold rule to stop
  // the auto-hiding bar taking it off screen. One tap does the same job, and blur
  // STRENGTH and quality — the only settings the strip never carried — stay in
  // More → Backgrounds & effects.
  const coarse = useIsTouch()
  const flipCamera = useFlipCamera()
  const blur = useBlurControls()
  const showSelfTools = p.isLocal && !isScreen && hasVideo && coarse

  // Double-tap / long-press / Enter action. Default = toggle pin; presentation overrides
  // it (spotlight a grid tile, or demote the big tile back to the plain grid).
  const activate = onActivate ?? (() => togglePin(p.identity))

  // Long-press (touch) — a second, more discoverable gesture alongside double-tap.
  // Real movement cancels it (the touch gallery scrolls), but not the pixel or two
  // a resting thumb always jitters: cancelling on ANY pointermove made the
  // long-press nearly impossible to land on a real phone.
  const pressTimer = useRef<number | undefined>(undefined)
  const pressFrom = useRef<{ x: number; y: number } | null>(null)
  const startPress = (e: React.PointerEvent) => {
    pressFrom.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = window.setTimeout(activate, 500)
  }
  const cancelPress = () => {
    pressFrom.current = null
    window.clearTimeout(pressTimer.current)
  }
  const movePress = (e: React.PointerEvent) => {
    const from = pressFrom.current
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) cancelPress()
  }

  // Read the video's intrinsic aspect off the <video> element and report it to the
  // grid packer. 'resize' fires when the publisher rotates their phone mid-call, so
  // the tile re-orients live; rAF retries only until the element mounts.
  const tileRef = useRef<HTMLDivElement>(null)
  // Also kept locally (not just reported up) so the tile can decide its own
  // object-fit — the letterbox-vs-crop call needs the source shape too.
  const [videoAspect, setVideoAspect] = useState(0)
  const wantsAspect = Boolean(onAspect) || boxAspect !== undefined
  // The grid passes `onAspect` as an inline closure (it binds the tile's key), so
  // its identity changes every render. Read it through a ref: with it in the deps,
  // every parent render tore down and re-attached the video listeners for nothing.
  const onAspectRef = useRef(onAspect)
  useEffect(() => {
    onAspectRef.current = onAspect
  })
  useEffect(() => {
    if (!wantsAspect || !hasVideo) return
    const root = tileRef.current
    if (!root) return
    let raf = 0
    let video: HTMLVideoElement | null = null
    const read = () => {
      if (video && video.videoWidth && video.videoHeight) {
        const ratio = video.videoWidth / video.videoHeight
        setVideoAspect(ratio)
        onAspectRef.current?.(ratio)
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
  }, [wantsAspect, hasVideo])

  // Letterbox rather than crop when the two shapes are far apart — a laptop's
  // landscape camera in a phone's tall tile. Shares are always contained (a
  // cropped screen share is unreadable); an unmeasured tile keeps filling.
  const letterbox =
    isScreen || (boxAspect !== undefined && videoAspect > 0 && badlyCropped(videoAspect, boxAspect))

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
      activate()
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
      onDoubleClick={activate}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onPointerMove={movePress}
      className={cn(
        'group relative overflow-hidden rounded-tile bg-sunken',
        // A tile is a gesture surface, not a document: without these a long-press
        // selected the name pill or raised iOS's callout, and double-tap (pin) could
        // zoom the page instead.
        'touch-manipulation select-none [-webkit-touch-callout:none]',
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
            letterbox ? 'bg-black object-contain' : 'object-cover',
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
          screen-level participants chip in the top-right corner.

          `md` (44px), not `sm` (36px): `showSelfTools` is already gated on `coarse`,
          so these two render on nothing but a thumb, and 44px is the size every
          other touch control in the app is held to — the island's rule, and the
          reason the mute control two blocks up takes `coarse ? 'md' : 'sm'`. They
          were 36px, which is over WCAG 2.5.8's 24px floor and under both platform
          guidelines, sitting on the one surface with no keyboard or hover fallback. */}
      {showSelfTools && (
        <div
          className="absolute bottom-12 right-2 z-10 flex flex-col gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton
            size="md"
            label="Flip camera"
            icon={<FlipCameraIcon />}
            tone="overlay"
            onClick={() => void flipCamera()}
          />
          {/* Hidden where the platform can't build the processor at all, the same
              call screen share makes on iOS — a button that silently does nothing
              is worse than no button. `mode` flips synchronously, so `active`
              lands on the first tap even though the ~160KB MediaPipe import means
              the blur itself arrives a beat later. */}
          {blur?.supported && (
            <IconButton
              size="md"
              label={blur.mode === 'blur' ? 'Turn off background blur' : 'Blur my background'}
              icon={<EffectsIcon />}
              // `overlay` + `active`: the over-video fill when off, and the same
              // accent on-state as every other toggle when on. `tone="accent"` would
              // resolve to toneActive.accent — the darker PRESSED shade — so this one
              // control would have looked different from the rest when switched on.
              active={blur.mode === 'blur'}
              pressed={blur.mode === 'blur'}
              tone="overlay"
              onClick={() => (blur.mode === 'blur' ? blur.useNone() : blur.useBlur())}
            />
          )}
        </div>
      )}

      {/* Top-right action. Default = Pin toggle, revealed on hover/focus (desktop);
          on touch we rely on double-tap / long-press instead (taught by PinCoachmark),
          since a persistent button collides with the screen-level participants chip.
          Presentation passes a custom `action` (spotlight / exit presentation) and
          shows it on touch too — those tiles have no other affordance. */}
      <TileActionStack>
        {action ? (
          <TileAction>
            <div
              className={cn(
                'transition-opacity duration-[var(--dur-fast)]',
                coarse ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100',
              )}
            >
              <IconButton
                size={coarse ? 'md' : 'sm'}
                label={action.label}
                icon={action.icon}
                // Deliberately no `active` fill: these corner actions have always
                // looked the same on and off over video (the label says which).
                tone="overlay"
                onClick={action.onClick}
              />
            </div>
          </TileAction>
        ) : (
          <TileAction>
            <div className="opacity-0 transition-opacity duration-[var(--dur-fast)] focus-within:opacity-100 group-hover:opacity-100">
              <IconButton
                size="sm"
                label={pinned ? `Unpin ${name}` : `Pin ${name}`}
                icon={<PinIcon />}
                // No `active` fill, as before the overlay tone: the label says
                // Pin / Unpin, and the tile itself shows it's pinned.
                tone="overlay"
                onClick={() => togglePin(p.identity)}
              />
            </div>
          </TileAction>
        )}
        {actions}
      </TileActionStack>

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
          {/* The suffix sits outside the truncation: a long name used to push
              "(you)" and "— screen" off the end, and those are the part that says
              whose tile this is. */}
          <span className="flex min-w-0 max-w-40">
            <span className="truncate" dir="auto">
              {name}
            </span>
            <span className="shrink-0 whitespace-pre">
              {p.isLocal ? ' (you)' : myOtherDevice ? ' (your device)' : ''}
              {isScreen ? ' — screen' : ''}
            </span>
          </span>
        </span>
        <ConnectionQuality participant={p} degradedOnly className="rounded-control bg-overlay p-1" />
      </div>
    </div>
  )
}
