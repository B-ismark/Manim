import { create } from 'zustand'

/** Stage layout modes (STYLE.md §5 layout switch). */
export type LayoutMode = 'grid' | 'speaker' | 'spotlight'

/** Which side panel tab is open, or null when the panel is closed. */
export type PanelTab = 'chat' | 'people' | null

interface RoomState {
  layout: LayoutMode
  /** Identity of a pinned/spotlit participant, or null. Drives speaker/spotlight focus. */
  pinned: string | null
  panel: PanelTab
  /** Unread chat count while the chat panel is closed (cleared on open). */
  unread: number

  setLayout: (layout: LayoutMode) => void
  /** Toggle pin for an identity; pinning auto-switches to speaker layout if in grid. */
  togglePin: (identity: string) => void
  setPanel: (panel: PanelTab) => void
  bumpUnread: (by?: number) => void
  clearUnread: () => void
}

export const useRoomStore = create<RoomState>((set) => ({
  layout: 'grid',
  pinned: null,
  panel: null,
  unread: 0,

  setLayout: (layout) => set({ layout }),
  togglePin: (identity) =>
    set((s) => {
      const pinned = s.pinned === identity ? null : identity
      // Pinning from the grid implies the user wants a focused view.
      const layout = pinned && s.layout === 'grid' ? 'spotlight' : s.layout
      return { pinned, layout }
    }),
  setPanel: (panel) => set((s) => ({ panel, unread: panel === 'chat' ? 0 : s.unread })),
  bumpUnread: (by = 1) => set((s) => ({ unread: s.unread + by })),
  clearUnread: () => set({ unread: 0 }),
}))
