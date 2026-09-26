import { useEffect, useRef } from 'react'
import { useDataChannel, useRoomContext } from '@livekit/components-react'
import { Encryption_Type, RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'

type Handler<T extends string> = NonNullable<Parameters<typeof useDataChannel<T>>[1]>

/**
 * Should a data packet be believed? On an end-to-end-encrypted call every
 * participant's packets arrive encrypted (lib/livekit sets `encryption`, which
 * covers the data channel). One that claims to come from a participant but
 * arrived in the clear can only have been made by something that doesn't hold
 * the key, which on an E2EE call includes the server, so it's dropped: otherwise
 * the server could put words in anyone's mouth. Packets from no participant (the
 * server's own control messages, e.g. "moved to another device") are allowed.
 */
export function acceptData(room: Room, from: RemoteParticipant | undefined, encryptionType?: Encryption_Type) {
  const encryptedCall = Boolean((room.options as { encryption?: unknown }).encryption)
  return !(encryptedCall && from && encryptionType === Encryption_Type.NONE)
}

/**
 * A data topic with a handler that can change every render.
 *
 * LiveKit's `useDataChannel` memoises its whole channel on `[room, topic,
 * onMessage]`, so an inline handler — which is how every call site wants to write
 * it — tore the channel down and built a new one on EVERY render. Two things broke
 * in a busy call, where something re-renders several times a second:
 *  - `send` from a render whose effects hadn't run yet threw ("Cannot read
 *    properties of undefined (reading 'next')"). A reply sent from inside a
 *    handler landed in exactly that window, which is how the late-joiner
 *    chat-history replay failed every time.
 *  - a message arriving between the old subscription closing and the new one
 *    opening was dropped.
 * So sending uses `useDataChannel(topic)` with no handler (stable), and receiving
 * is ONE room listener for the life of the component that calls whatever handler
 * the latest render supplied. It listens itself rather than through the hook
 * because only the raw event carries the packet's encryption type (acceptData).
 */
export function useDataTopic<T extends string>(topic: T, onMessage: Handler<T>) {
  const room = useRoomContext()
  const handler = useRef(onMessage)
  handler.current = onMessage
  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      from?: RemoteParticipant,
      _kind?: unknown,
      t?: string,
      encryptionType?: Encryption_Type,
    ) => {
      if (t !== topic || !acceptData(room, from, encryptionType)) return
      handler.current({ payload, topic, from } as Parameters<Handler<T>>[0])
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room, topic])
  return useDataChannel(topic)
}
