import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useRoomInfo,
} from '@livekit/components-react'
import { RoomEvent, type RemoteParticipant } from 'livekit-client'
import { AnnotationEngine } from './AnnotationEngine'
import { decode, encode, targetHash, type StrokePacket } from '@/lib/annotate/wire'
import { colorIndexFor } from '@/lib/annotate/palette'
import { useAnnotateStore } from '@/store/useAnnotateStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'

/** Ephemeral stroke broadcast topic. */
const ANNOTATE_TOPIC = 'mn.annotate'

/** Minimum gap between "X is annotating" announcements for the same author. */
const ANNOUNCE_COOLDOWN_MS = 15_000

/**
 * Annotation is ON, with an explicit kill switch.
 *
 * It shipped dark while the LiveKit test gates were frozen, because multi-party
 * stroke agreement can only be proven against a real room. That verification has
 * since been done against a local server: two participants on deliberately
 * different viewport shapes see a stroke on the same content pixel (17-annotate),
 * touch stays view-only, axe passes light and dark, and three people drawing at
 * once on a 4x-throttled observer retains ~85% of the share's decode rate
 * (18-annotate-perf).
 *
 * The sense is inverted rather than the default flipped: an opt-IN flag would
 * have needed a build variable added in Cloudflare to take effect, so the feature
 * would have stayed dark in production while looking enabled in the repo. Set
 * VITE_ANNOTATE=false to turn it off without a revert.
 */
export const annotateEnabled = import.meta.env.VITE_ANNOTATE !== 'false'

const displayName = (identity: string, name?: string) => name || identity.split('#')[0] || 'Guest'

/**
 * Wires AnnotationEngine to the LiveKit data channel.
 *
 * The receive path is the perf-critical half: the handler decodes straight into
 * the engine and returns. It calls no setState, so an inbound packet costs zero
 * React renders, and the engine's frame loop coalesces packets from every peer
 * into one repaint.
 *
 * That was the intent, and for a long time it was not what happened. The handler
 * itself is clean, but it used to be registered through `useDataChannel`, which
 * ALSO keeps the latest message in React state — so every inbound packet re-rendered
 * this hook's component regardless of what the handler did. Measured on a viewer
 * while one person scribbled: 105 renders per second, against 0 when idle. The
 * component carrying the canvas re-rendered on every packet from every peer, which
 * is exactly the cost the comment above claims is avoided, and it showed up as the
 * shared screen going choppy while anyone was drawing.
 *
 * So the subscription is made directly against RoomEvent.DataReceived and the
 * handler is reached through a ref. Nothing here calls setState on a packet now.
 * If you reintroduce useDataChannel, re-measure — its `message` state is the trap.
 */
export function useAnnotate(featuredShareId: string | null) {
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()

  // Which share ink is currently aimed at, as the 32-bit form that goes on the wire.
  // Held in a ref because the engine flushes from its own frame loop, outside React's
  // render cycle — capturing the value would pin it to whichever render built the
  // engine (which happens exactly once).
  const targetRef = useRef(0)
  const target = targetHash(featuredShareId)
  targetRef.current = target

  // `send` isn't available until useDataChannel has run, and the engine is built
  // before that — so the engine calls through a ref rather than capturing it.
  const sendRef = useRef<((bytes: Uint8Array) => void) | null>(null)

  const engine = useMemo(
    () =>
      new AnnotationEngine({
        onFlush: (packet: StrokePacket) =>
          sendRef.current?.(encode({ ...packet, target: targetRef.current })),
      }),
    [],
  )

  useEffect(() => () => engine.destroy(), [engine])

  const announce = useAnnounce()
  const noteRemoteInk = useAnnotateStore((s) => s.noteRemoteInk)
  // Last announcement per author, so a burst of packets doesn't spam the live
  // region. Strokes are invisible to a screen reader, so "X is annotating" is the
  // only signal those users get — it has to be present but not constant.
  const announcedAt = useRef(new Map<string, number>())

  const room = useRoomContext()

  // The latest handler, reachable from a subscription that is made once. Refreshed
  // after every render so it always closes over current props/state, without the
  // subscription itself churning.
  const onPacket = useRef<(payload: Uint8Array, from?: RemoteParticipant) => void>(() => {})
  onPacket.current = (payload, from) => {
    // Attribution comes from the SFU-attributed sender, never the payload — a
    // payload field would let anyone draw under someone else's name.
    const identity = from?.identity
    if (!identity || identity === localParticipant.identity) return
    const packet = decode(payload)
    if (!packet) return
    // Ink is addressed in unit coordinates against the share it was drawn on, so a
    // stroke aimed at a DIFFERENT share would land somewhere arbitrary on this one.
    // target 0 means "unspecified" — every v1 sender, and anything drawn before a
    // SID was known — and stays accepted, which is what keeps a mixed-version room
    // working in one direction rather than neither.
    if (packet.target !== 0 && packet.target !== targetRef.current) return
    const name = displayName(identity, from?.name)
    engine.ingest(identity, packet, name)

    const last = announcedAt.current.get(identity) ?? 0
    const nowMs = Date.now()
    if (nowMs - last > ANNOUNCE_COOLDOWN_MS) {
      announcedAt.current.set(identity, nowMs)
      announce(`${name} is annotating the shared screen`)
      // The visible counterpart of that announcement, for touch devices where the
      // pen doesn't exist and ink would otherwise appear unexplained. Rides the same
      // cooldown deliberately: this is the only store write on the receive path, and
      // it must stay one-per-author-per-15s rather than one-per-packet.
      noteRemoteInk(name)
    }
  }

  useEffect(() => {
    if (!room) return
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== ANNOTATE_TOPIC) return
      onPacket.current(payload, participant)
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room])

  useEffect(() => {
    sendRef.current = (bytes) => {
      // Lossy: ink wants freshness over completeness, and because strokes fade a
      // dropped packet is off the screen in a couple of seconds anyway.
      void room?.localParticipant
        .publishData(bytes, { reliable: false, topic: ANNOTATE_TOPIC })
        .catch(() => {
          /* best-effort by design */
        })
    }
    return () => {
      sendRef.current = null
    }
  }, [room])

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

  // Handed back so the overlay can colour the armed cursor without subscribing to
  // useParticipants() a second time — that hook re-emits on speaking-state churn,
  // and the overlay is the one component in the feature that must stay quiet.
  return { engine, beginLocal, localColorIdx }
}
