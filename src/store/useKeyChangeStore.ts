import { create } from 'zustand'

/**
 * The one question a ring can stop to ask (lib/devicePins), before the call's
 * key is sealed to devices this browser hasn't trusted. App-level, not tied to
 * the screen that rang: calling from Home drops you straight into the room while
 * the ring goes out, and the question has to survive that.
 *
 * - `added`: a device of theirs we've never seen (a new phone, or someone else
 *   signed in to their account).
 * - `changed`: a device we know, with a different key.
 * - `unprotected`: we know they have devices, but none came back to seal to, so
 *   the key would travel in the clear.
 */
export type KeyChangeKind = 'added' | 'changed' | 'unprotected'

/** A ring's moment passes: an unanswered question counts as "don't ring". */
const ASK_FOR_MS = 45_000

interface Pending {
  name: string
  kind: KeyChangeKind
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

/** Ask whether to ring `name` anyway. Resolves false when dismissed or left too long. */
export function askKeyChange(name: string, kind: KeyChangeKind): Promise<boolean> {
  // A question already showing is answered "no" by the new one replacing it.
  useKeyChangeStore.getState().pending?.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const settle = (ring: boolean) => {
      if (done) return
      done = true
      window.clearTimeout(t)
      resolve(ring)
    }
    const t = window.setTimeout(() => {
      if (useKeyChangeStore.getState().pending?.resolve === settle) useKeyChangeStore.getState().answer(false)
    }, ASK_FOR_MS)
    useKeyChangeStore.setState({ pending: { name, kind, resolve: settle } })
  })
}
