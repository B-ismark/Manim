import { create } from 'zustand'

/**
 * Annotation TOOLBAR state only — whether the pen is armed, and whether the room
 * currently permits drawing.
 *
 * Deliberately tiny, and deliberately NOT where strokes live. Stroke data is
 * owned imperatively by AnnotationEngine; putting points in a store would
 * re-render the stage on every pointer sample. Nothing on the hot path reads
 * this store — the engine samples it once, at pointerdown, via getState().
 *
 * Stage must not subscribe to this: arming the pen should not re-render the
 * video grid. Only the control bar and the overlay do.
 */
interface AnnotateState {
  /** The local user has the pen armed. */
  active: boolean
  /** Room policy allows this participant to draw (host may restrict to hosts). */
  allowed: boolean
  setActive: (active: boolean) => void
  setAllowed: (allowed: boolean) => void
  toggle: () => void
}

export const useAnnotateStore = create<AnnotateState>()((set, get) => ({
  active: false,
  allowed: true,
  setActive: (active) => set({ active }),
  // Losing permission mid-session must also disarm the pen, or the overlay would
  // keep swallowing pointer events with nothing to show for them.
  setAllowed: (allowed) => set({ allowed, active: allowed ? get().active : false }),
  toggle: () => set({ active: get().allowed && !get().active }),
}))
