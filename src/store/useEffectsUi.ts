import { create } from 'zustand'

/**
 * UI-only state for the Snapchat-style effects carousel. Kept in a store (not
 * props) so the self-view tile can open it without threading a callback through
 * every Stage tile, and RoomView can render the strip as a sibling of the bar.
 */
interface EffectsUiState {
  carouselOpen: boolean
  openCarousel: () => void
  closeCarousel: () => void
  toggleCarousel: () => void
}

export const useEffectsUi = create<EffectsUiState>((set) => ({
  carouselOpen: false,
  openCarousel: () => set({ carouselOpen: true }),
  closeCarousel: () => set({ carouselOpen: false }),
  toggleCarousel: () => set((s) => ({ carouselOpen: !s.carouselOpen })),
}))
