import { create } from 'zustand'
import { isMobile } from '@/lib/device'

/** Stage layout modes (STYLE.md §5 layout switch). */
export type LayoutMode = 'grid' | 'speaker'

/**
 * Max tiles per page in the grid (Teams-style "gallery size"). `'auto'` keeps the
 * fit-to-viewport behaviour; a number caps the page so the user can choose density
 * (small tiles + pager, or fewer + bigger). The legible steps differ by device — the
 * picker offers 2/4/9 on phones, 4/9/16 on desktop — but any value is clamped to
 * what the viewport can actually hold (see gridCapacity).
 */
export type GridSize = 'auto' | 2 | 4 | 9 | 16

/** Which side panel tab is open, or null when the panel is closed. */
export type PanelTab = 'chat' | 'people' | null

// View prefs persist per device (a deliberate, low-churn choice — not call state).
const GRID_SIZE_KEY = 'mn.gridSize'
const VIDEOS_FIRST_KEY = 'mn.videosFirst'

function loadGridSize(): GridSize {
  try {
    const raw = localStorage.getItem(GRID_SIZE_KEY)
    if (raw === 'auto') return 'auto'
    const n = Number(raw)
    return n === 2 || n === 4 || n === 9 || n === 16 ? (n as GridSize) : 'auto'
  } catch {
    return 'auto'
  }
}
function loadVideosFirst(): boolean {
  try {
    return localStorage.getItem(VIDEOS_FIRST_KEY) === '1'
  } catch {
    return false
  }
}

interface RoomState {
  layout: LayoutMode
  /** Max tiles per page in the grid; 'auto' = fit-to-viewport. Persisted per device. */
  gridSize: GridSize
  /** Order camera-on tiles ahead of avatar/camera-off ones. Persisted per device. */
  videosFirst: boolean
  /** Identity of a pinned participant, or null. Drives the speaker-layout focus. */
  pinned: string | null
  /**
   * Screen-share presentation layout (big content + segmented user grid).
   * `spotlightKey` = the tile key currently in the big slot; null = auto (the active
   * share). Tapping a grid tile spotlights it (person-swap). `demotedShares` = share
   * track SIDs the viewer demoted back to the plain grid — remembered per share session,
   * so a NEW share (different SID) re-promotes automatically.
   */
  spotlightKey: string | null
  demotedShares: string[]
  /**
   * The share that currently HOLDS the big region, by track SID.
   *
   * Exists so the choice is sticky. primaryShare() used to re-pick on
   * `participant.isSpeaking`, so with two presenters the featured share swapped
   * every time they took a turn talking — and ink, which is addressed in unit
   * coordinates against whatever is featured, followed it onto the wrong screen.
   * Pruned alongside the other presentation state when that share ends.
   */
  stickyShareId: string | null
  /**
   * This device joined as a COMPANION — the same account is already in the call on
   * another device, and the user chose "join anyway". Mic + camera start off and the
   * speaker is muted to avoid echo (Meet/Teams companion model). Cleared when the user
   * takes over audio or transfers here.
   */
  companion: boolean
  panel: PanelTab
  /** Unread chat count while the chat panel is closed (cleared on open). */
  unread: number
  /** Facing mode of the local camera. Front ('user') is mirrored like a selfie;
   *  rear ('environment') must NOT be mirrored or the world looks flipped. */
  selfFacing: 'user' | 'environment'
  /** Drop your own camera from your stage — the desktop grid tile, the touch
   *  gallery cell, and the floating self-view card alike. You still SEND video;
   *  you just don't see it. */
  selfViewHidden: boolean
  /** Audio-only / low-bandwidth: render avatars instead of decoding remote video. */
  audioOnly: boolean
  /**
   * What kind of surface YOUR screen share is capturing, straight from
   * `getSettings().displaySurface`.
   *
   * This is the fact that decides whether echoing your own share back to you is
   * safe. A window or a tab cannot contain the call, so the echo is harmless and
   * useful (it is what makes annotation discoverable). A whole monitor DOES contain
   * the call, so the echo recurses into a mirror tunnel and re-captures your own
   * cursor — the two symptoms that were reported.
   *
   * 'unknown' when nothing is shared, and when the browser doesn't report the field
   * (Firefox historically, and any synthetic capture). Unknown is treated as
   * PERMISSIVE — see showOwnShare in Stage.tsx. Guessing 'monitor' would remove
   * annotation from every browser that stays quiet, which is a worse failure than
   * the mirror it would prevent, and `showOwnShareOverride` is the escape hatch
   * either way.
   */
  shareSurface: 'monitor' | 'window' | 'browser' | 'unknown'
  /**
   * Explicit user override for whether your own share is echoed onto your stage.
   * null = follow `shareSurface`. Set by the "Show/Hide my shared screen" toggle on
   * the presenting pill, so a presenter is never stuck with the app's guess —
   * including on browsers that report no surface type at all.
   */
  showOwnShareOverride: boolean | null

  setLayout: (layout: LayoutMode) => void
  /** Swipe / arrow step. Floors at 0; the upper bound is clamped on read. */
  setGridSize: (size: GridSize) => void
  toggleVideosFirst: () => void
  toggleSelfView: () => void
  toggleAudioOnly: () => void
  /** Toggle pin for an identity; pinning auto-switches to speaker layout if in grid. */
  togglePin: (identity: string) => void
  /** Mark/clear this device as a muted companion (same account elsewhere). */
  setCompanion: (companion: boolean) => void
  /** Presentation: put a tile in the big slot (person-swap); null resets to the share. */
  setSpotlight: (key: string | null) => void
  /** Presentation: demote a share (by SID) back to the plain grid, or re-promote it. */
  toggleShareDemoted: (shareId: string) => void
  /** Record which share holds the big region, so the choice survives someone talking. */
  setStickyShare: (shareId: string | null) => void
  /** Drop stale presentation state when shares end/change (called from Stage). Prunes
   *  demoted SIDs no longer active and clears a spotlight whose tile is gone. */
  prunePresentation: (activeShareIds: string[], validKeys: string[]) => void
  /** Record the surface type of the local share (called from useScreenShare).
   *  Passing 'unknown' also clears any showOwnShareOverride — a new share is a new
   *  decision, and a stale override from the last one would silently apply to it. */
  setShareSurface: (surface: RoomState['shareSurface']) => void
  /** Flip the "show my own shared screen" override away from whatever is currently
   *  effective. Takes the current effective value so the first tap always visibly
   *  changes something, whichever way the surface-type default pointed. */
  toggleOwnShareShown: (currentlyShown: boolean) => void
  setPanel: (panel: PanelTab) => void
  bumpUnread: (by?: number) => void
  clearUnread: () => void
  setSelfFacing: (facing: 'user' | 'environment') => void
}

export const useRoomStore = create<RoomState>((set) => ({
  // Phones default to active-speaker (one large feed), desktops to the gallery —
  // the convention on both, and for the same reason: a √n grid on a tall narrow
  // screen makes every tile tiny, while a wide screen has room to show everyone.
  // One value, both pointer types: the stage view switcher (touch) and More → View
  // (both) set this, so the app has a single answer to "what am I looking at".
  layout: isMobile() ? 'speaker' : 'grid',
  gridSize: loadGridSize(),
  videosFirst: loadVideosFirst(),
  pinned: null,
  spotlightKey: null,
  demotedShares: [],
  stickyShareId: null,
  companion: false,
  panel: null,
  unread: 0,
  selfFacing: 'user',
  selfViewHidden: false,
  audioOnly: false,
  shareSurface: 'unknown',
  showOwnShareOverride: null,

  setLayout: (layout) => set({ layout }),
  setGridSize: (gridSize) =>
    set(() => {
      try {
        localStorage.setItem(GRID_SIZE_KEY, String(gridSize))
      } catch {
        /* storage blocked — keep in memory only */
      }
      return { gridSize }
    }),
  toggleVideosFirst: () =>
    set((s) => {
      const videosFirst = !s.videosFirst
      try {
        localStorage.setItem(VIDEOS_FIRST_KEY, videosFirst ? '1' : '0')
      } catch {
        /* storage blocked */
      }
      return { videosFirst }
    }),
  setSelfFacing: (selfFacing) => set({ selfFacing }),
  toggleSelfView: () => set((s) => ({ selfViewHidden: !s.selfViewHidden })),
  toggleAudioOnly: () => set((s) => ({ audioOnly: !s.audioOnly })),
  togglePin: (identity) =>
    set((s) => {
      const pinned = s.pinned === identity ? null : identity
      // Pinning from the grid implies the user wants a focused view.
      const layout = pinned && s.layout === 'grid' ? 'speaker' : s.layout
      return { pinned, layout }
    }),
  setCompanion: (companion) => set({ companion }),
  setSpotlight: (spotlightKey) => set({ spotlightKey }),
  setStickyShare: (stickyShareId) =>
    set((s) => (s.stickyShareId === stickyShareId ? s : { stickyShareId })),
  toggleShareDemoted: (shareId) =>
    set((s) => {
      const demoted = s.demotedShares.includes(shareId)
      return {
        demotedShares: demoted
          ? s.demotedShares.filter((id) => id !== shareId)
          : [...s.demotedShares, shareId],
        // Demoting to the plain grid drops any person-spotlight too (clean reset).
        spotlightKey: demoted ? s.spotlightKey : null,
      }
    }),
  prunePresentation: (activeShareIds, validKeys) =>
    set((s) => {
      const demotedShares = s.demotedShares.filter((id) => activeShareIds.includes(id))
      // The sticky share joins the same prune rather than getting its own effect —
      // there were already three cleanup paths here, and a fourth independent one is
      // exactly how they drift. A key pointing at a share that has ended would pin
      // the big region to nothing.
      const stickyShareId =
        s.stickyShareId && activeShareIds.includes(s.stickyShareId) ? s.stickyShareId : null
      // Clear the spotlight when its tile is gone OR once every share has ended (so the
      // next share starts big by default rather than inheriting a stale person-spotlight).
      const spotlightKey =
        s.spotlightKey && (activeShareIds.length === 0 || !validKeys.includes(s.spotlightKey))
          ? null
          : s.spotlightKey
      // Return a stable reference when nothing changed so the effect that calls this
      // doesn't loop (zustand bails on identical primitives but not new arrays).
      const sameDemoted = demotedShares.length === s.demotedShares.length
      if (sameDemoted && spotlightKey === s.spotlightKey && stickyShareId === s.stickyShareId) {
        return s
      }
      return {
        demotedShares: sameDemoted ? s.demotedShares : demotedShares,
        spotlightKey,
        stickyShareId,
      }
    }),
  setShareSurface: (shareSurface) =>
    set((s) =>
      shareSurface === 'unknown'
        ? { shareSurface, showOwnShareOverride: null }
        : s.shareSurface === shareSurface
          ? s
          : { shareSurface },
    ),
  toggleOwnShareShown: (currentlyShown) => set({ showOwnShareOverride: !currentlyShown }),
  setPanel: (panel) => set((s) => ({ panel, unread: panel === 'chat' ? 0 : s.unread })),
  bumpUnread: (by = 1) => set((s) => ({ unread: s.unread + by })),
  clearUnread: () => set({ unread: 0 }),
}))
