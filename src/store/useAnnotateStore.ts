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
  /**
   * Who most recently drew on the shared screen, for the benefit of people who
   * cannot draw back.
   *
   * Touch is view-only by design, and the pen control is hidden there entirely — so a
   * phone user watching strokes bloom and fade over a shared screen got no label, no
   * control and no explanation. The author's name IS drawn beside the live stroke
   * head, but only while the stroke is alive, which on a small screen is easy to miss.
   * Written at most once per author per announcement cooldown, never per packet:
   * stroke data must never reach a store (see AnnotationEngine's header).
   */
  remoteInkBy: string | null
  setActive: (active: boolean) => void
  noteRemoteInk: (name: string | null) => void
  setAllowed: (allowed: boolean) => void
  toggle: () => void
}

export const useAnnotateStore = create<AnnotateState>()((set, get) => ({
  active: false,
  allowed: true,
  remoteInkBy: null,
  setActive: (active) => set({ active }),
  noteRemoteInk: (remoteInkBy) => set({ remoteInkBy }),
  // Losing permission mid-session must also disarm the pen, or the overlay would
  // keep swallowing pointer events with nothing to show for them.
  setAllowed: (allowed) => set({ allowed, active: allowed ? get().active : false }),
  toggle: () => set({ active: get().allowed && !get().active }),
}))
