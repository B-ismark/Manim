import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomInfo,
} from '@livekit/components-react'
import { AnnotationEngine } from './AnnotationEngine'
import { decode, encode, type StrokePacket } from '@/lib/annotate/wire'
import { colorIndexFor } from '@/lib/annotate/palette'
import { useAnnotateStore } from '@/store/useAnnotateStore'

/** Ephemeral stroke broadcast topic. */
const ANNOTATE_TOPIC = 'mn.annotate'

/**
 * Annotation is off unless the build flag turns it on (same pattern as the GIF
 * picker). Multi-party stroke agreement can only be verified against a real
 * LiveKit room, so while the test gates are frozen the feature ships dark and is
 * enabled once two participants on different viewport sizes have been confirmed
 * to see strokes in the same place.
 */
export const annotateEnabled = import.meta.env.VITE_ANNOTATE === 'true'

const displayName = (identity: string, name?: string) => name || identity.split('#')[0] || 'Guest'

/**
 * Wires AnnotationEngine to the LiveKit data channel.
 *
 * The receive path is the perf-critical half: the handler decodes straight into
 * the engine and returns. It calls no setState, so an inbound packet costs zero
 * React renders, and the engine's frame loop coalesces packets from every peer
 * into one repaint.
 */
export function useAnnotate() {
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()

  // `send` isn't available until useDataChannel has run, and the engine is built
  // before that — so the engine calls through a ref rather than capturing it.
  const sendRef = useRef<((bytes: Uint8Array) => void) | null>(null)

  const engine = useMemo(
    () =>
      new AnnotationEngine({
        onFlush: (packet: StrokePacket) => sendRef.current?.(encode(packet)),
      }),
    [],
  )

  useEffect(() => () => engine.destroy(), [engine])

  const { send } = useDataChannel(ANNOTATE_TOPIC, (msg) => {
    // Attribution comes from the SFU-attributed sender, never the payload — a
    // payload field would let anyone draw under someone else's name.
    const identity = msg.from?.identity
    if (!identity || identity === localParticipant.identity) return
    const packet = decode(msg.payload)
    if (!packet) return
    engine.ingest(identity, packet, displayName(identity, msg.from?.name))
  })

  useEffect(() => {
    sendRef.current = (bytes) => {
      // Lossy: ink wants freshness over completeness, and because strokes fade a
      // dropped packet is off the screen in a couple of seconds anyway.
      void send(bytes, { reliable: false, topic: ANNOTATE_TOPIC })?.catch?.(() => {
        /* best-effort by design */
      })
    }
    return () => {
      sendRef.current = null
    }
  }, [send])

  // Colour is assigned by position in the sorted roster, so every client derives
  // the same colour for the same person. Resolved to a NUMBER here: useParticipants()
  // re-emits on speaking-state churn, and the effect below must only re-run when
  // the assignment actually changes, not on every re-emit.
  const roster = useMemo(
    () => participants.map((p) => p.identity).sort((a, b) => a.localeCompare(b)),
    [participants],
  )
  const localColorIdx = useMemo(
    () => colorIndexFor(localParticipant.identity, roster),
    [roster, localParticipant.identity],
  )

  useEffect(() => {
    engine.setLocalAuthor(
      localColorIdx,
      displayName(localParticipant.identity, localParticipant.name),
    )
  }, [engine, localColorIdx, localParticipant.identity, localParticipant.name])

  // Drawing policy comes from server-written ROOM metadata, the same authority
  // source as lock/waiting — never participant metadata, which a client can
  // rewrite. An absent flag means everyone may draw.
  const { metadata: roomMetadata } = useRoomInfo()
  const setAllowed = useAnnotateStore((s) => s.setAllowed)

  useEffect(() => {
    let hostOnly = false
    let hostId = ''
    let coHosts: string[] = []
    try {
      const f = JSON.parse(roomMetadata || '{}')
      hostOnly = Boolean(f.annotateHostOnly)
      hostId = f.hostId || ''
      coHosts = Array.isArray(f.coHosts) ? f.coHosts : []
    } catch {
      /* malformed metadata — fall back to permissive, matching the default */
    }
    const me = localParticipant.identity
    setAllowed(!hostOnly || me === hostId || coHosts.includes(me))
  }, [roomMetadata, localParticipant.identity, setAllowed])

  const beginLocal = useCallback(
    (p: { x: number; y: number }) => engine.beginLocal(p, localParticipant.identity),
    [engine, localParticipant.identity],
  )

  return { engine, beginLocal }
}
