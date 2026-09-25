import { useCallback, useRef } from 'react'
import { useDataChannel } from '@livekit/components-react'

type Handler<T extends string> = NonNullable<Parameters<typeof useDataChannel<T>>[1]>

/**
 * `useDataChannel` with a handler that can change every render.
 *
 * The LiveKit hook memoises its whole channel on `[room, topic, onMessage]`, so an
 * inline handler — which is how every call site wants to write it — tears the
 * channel down and builds a new one on EVERY render. Two things break in a busy
 * call, where something re-renders several times a second:
 *  - `send` from a render whose effects haven't run yet throws ("Cannot read
 *    properties of undefined (reading 'next')": its sending-state subscriber
 *    doesn't exist yet). A reply sent from inside a handler lands in exactly that
 *    window, which is how the late-joiner chat-history replay failed every time.
 *  - a message that arrives between the old subscription closing and the new one
 *    opening is dropped.
 * So the hook gets ONE stable function for the life of the component, and that
 * calls whatever handler the latest render supplied. `send` is then stable too.
 */
export function useDataTopic<T extends string>(topic: T, onMessage: Handler<T>) {
  const handler = useRef(onMessage)
  handler.current = onMessage
  const stable = useCallback<Handler<T>>((msg) => handler.current(msg), [])
  return useDataChannel(topic, stable)
}
