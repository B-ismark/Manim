import { create } from 'zustand'
import { isMobile } from '@/lib/device'

/** Stage layout modes (STYLE.md §5 layout switch). */
export type LayoutMode = 'grid' | 'speaker'

/** Which side panel tab is open, or null when the panel is closed. */
export type PanelTab = 'chat' | 'people' | null

interface RoomState {
  layout: LayoutMode
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
  pinned: null,
  panel: null,
  unread: 0,
  selfFacing: 'user',
  selfViewHidden: false,
  audioOnly: false,

  setLayout: (layout) => set({ layout }),
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
