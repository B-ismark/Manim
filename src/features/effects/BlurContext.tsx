import { createContext, useContext, type ReactNode } from 'react'
import type { BackgroundBlurControls } from './useBackgroundBlur'

/**
 * The one live blur processor, shared with the stage.
 *
 * `useBackgroundBlur` owns a real camera processor, so there can only ever be one
 * instance — it lives in RoomView (above the panel/menu open-close churn) and the
 * control bar takes it as a prop. The self-view TILE needs it too, and a prop
 * can't get there: `Tile` is rendered from eight places across four stage layouts,
 * so threading blur controls to it means touching every one of them and every
 * layout added afterwards.
 *
 * This replaces the store (`useEffectsUi`) that used to bridge the same gap for
 * the effects carousel. A store had to MIRROR the hook's state, which means a sync
 * effect and a window where the two disagree; a context passes the single instance
 * itself, so the tile's toggle and the More menu's controls are provably the same
 * object.
 *
 * Null outside a provider (a test mounting a tile on its own), and callers treat
 * that as "no blur affordance" rather than crashing.
 */
const BlurContext = createContext<BackgroundBlurControls | null>(null)

export function BlurProvider({
  controls,
  children,
}: {
  controls: BackgroundBlurControls
  children: ReactNode
}) {
  return <BlurContext.Provider value={controls}>{children}</BlurContext.Provider>
}

/** The shared blur controls, or null outside a BlurProvider. */
export function useBlurControls(): BackgroundBlurControls | null {
  return useContext(BlurContext)
}
