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
  panel: PanelTab
  /** Unread chat count while the chat panel is closed (cleared on open). */
  unread: number
  /** Facing mode of the local camera. Front ('user') is mirrored like a selfie;
   *  rear ('environment') must NOT be mirrored or the world looks flipped. */
  selfFacing: 'user' | 'environment'
  /** Hide your own floating self-view (you still send video; you just don't see it). */
  selfViewHidden: boolean
  /** Audio-only / low-bandwidth: render avatars instead of decoding remote video. */
  audioOnly: boolean

  setLayout: (layout: LayoutMode) => void
  setGridSize: (size: GridSize) => void
  toggleVideosFirst: () => void
  toggleSelfView: () => void
  toggleAudioOnly: () => void
  /** Toggle pin for an identity; pinning auto-switches to speaker layout if in grid. */
  togglePin: (identity: string) => void
  setPanel: (panel: PanelTab) => void
  bumpUnread: (by?: number) => void
  clearUnread: () => void
  setSelfFacing: (facing: 'user' | 'environment') => void
}

export const useRoomStore = create<RoomState>((set) => ({
  // Portrait phones default to active-speaker (one large feed + filmstrip) — the
  // mobile convention. A √n grid on a tall narrow screen makes every tile tiny.
  // Desktop keeps the grid. User can switch either way (layout chip / More).
  layout: isMobile() ? 'speaker' : 'grid',
  gridSize: loadGridSize(),
  videosFirst: loadVideosFirst(),
  pinned: null,
  panel: null,
  unread: 0,
  selfFacing: 'user',
  selfViewHidden: false,
  audioOnly: false,

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
  setPanel: (panel) => set((s) => ({ panel, unread: panel === 'chat' ? 0 : s.unread })),
  bumpUnread: (by = 1) => set((s) => ({ unread: s.unread + by })),
  clearUnread: () => set({ unread: 0 }),
}))
