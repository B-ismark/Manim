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
 * `active` is read by the two controls that arm the pen (the control bar and the
 * button on the share tile) and by the presenting pill, which names the mode.
 * Arming no longer changes the LAYOUT — a presenter sees their own share the
 * whole time they're sharing — so a toggle costs a pill, not a re-flow. What must
 * never reach this store is stroke data: points live in AnnotationEngine, or every
 * pointer sample would re-render the grid.
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
