import { create } from 'zustand'

/**
 * The one question a ring can stop to ask: a contact's known device has a
 * different key (lib/devicePins). App-level, not tied to the screen that rang:
 * calling from Home drops you straight into the room while the ring goes out,
 * and the question has to survive that.
 */
interface Pending {
  name: string
  resolve: (ring: boolean) => void
}

interface KeyChangeState {
  pending: Pending | null
  answer: (ring: boolean) => void
}

export const useKeyChangeStore = create<KeyChangeState>((set, get) => ({
  pending: null,
  answer: (ring) => {
    get().pending?.resolve(ring)
    set({ pending: null })
  },
}))

/** Ask whether to ring `name` anyway. Resolves false when dismissed. */
export function askKeyChange(name: string): Promise<boolean> {
  // A question already showing is answered "no" by the new one replacing it.
  useKeyChangeStore.getState().pending?.resolve(false)
  return new Promise((resolve) => useKeyChangeStore.setState({ pending: { name, resolve } }))
}
