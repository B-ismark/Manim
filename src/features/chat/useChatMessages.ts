import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { ConnectionState, type ByteStreamHandler } from 'livekit-client'
import { useRoomStore } from '@/store/useRoomStore'
import { plainText } from '@/features/chat/mentions'
import { sounds } from '@/lib/sounds'
import { toast } from '@/store/useToastStore'

/** Data-channel topic for P2P file transfer (no storage at rest — streams through the SFU). */
const FILE_TOPIC = 'mn.file'
/** Pin broadcast topic — pins are shared across the room (Slack model). */
const PIN_TOPIC = 'mn.pin'
/** Per-message chat reactions. DISTINCT from the in-call floating-reaction topic
 *  ('mn.reaction' in useReactions) — sharing it made every chat reaction (and
 *  un-reaction) spawn a floating emoji + sound on the main stage. */
const REACTION_TOPIC = 'mn.chat-reaction'
/** Message-edit topic — author edits broadcast to everyone (overlay on the body). */
const EDIT_TOPIC = 'mn.edit'
/** Chat-history sync topic — peers replay the timeline to a (re)joiner. */
const HISTORY_TOPIC = 'mn.chat-history'
/** Cap how many past messages we replay/keep, to bound the data-channel payload. */
const HISTORY_LIMIT = 200
/** Typing-indicator topic — ephemeral "X is typing" pings. */
const TYPING_TOPIC = 'mn.typing'
/** A typing ping is considered stale (typer stopped / left) after this long. */
const TYPING_TTL_MS = 4000

/** Reactions for one message: emoji → identities who reacted with it. */
export type MessageReactions = Record<string, string[]>
/** All reactions in the room: message id → its reactions. */
export type ReactionMap = Record<string, MessageReactions>

/** A quoted message a reply points at (denormalized so it renders without history). */
export interface ReplyRef {
  name: string
  text: string
  /** Id of the original message, so the quote can scroll back to it when tapped.
   *  Optional — replies from older clients (no id in the envelope) still render. */
  id?: string
}

/** A pinned message snapshot (shared via PIN_TOPIC). */
export interface PinnedMessage {
  id: string
  name: string
  text: string
  timestamp: number
}

// Reply envelope: encoded inline in the chat text (LiveKit useChat only carries a
// string), parsed back on receive so every client renders the quote. Control
// chars users won't type delimit it.
const REPLY_START = ''
const REPLY_END = ''
function encodeText(text: string, replyTo?: ReplyRef): string {
  if (!replyTo) return text
  const meta = { n: replyTo.name, t: replyTo.text.slice(0, 160), i: replyTo.id }
  return REPLY_START + JSON.stringify(meta) + REPLY_END + text
}
function decodeText(raw: string): { text: string; replyTo?: ReplyRef } {
  if (!raw.startsWith(REPLY_START)) return { text: raw }
  const end = raw.indexOf(REPLY_END)
  if (end < 0) return { text: raw }
  try {
    const meta = JSON.parse(raw.slice(REPLY_START.length, end)) as { n?: string; t?: string; i?: string }
    return { text: raw.slice(end + 1), replyTo: { name: meta.n ?? '', text: meta.t ?? '', id: meta.i } }
  } catch {
    return { text: raw }
  }
}

export interface TextItem {
  kind: 'text'
  id: string
  timestamp: number
  fromIdentity: string
  fromName: string
  isLocal: boolean
  text: string
  replyTo?: ReplyRef
  /** True once the author has edited this message. */
  edited?: boolean
  /**
   * True for a message that arrived via peer history-replay (sent before you
   * joined), NOT live through the SFU. Its author identity comes from the
   * replaying peer's payload and is NOT verified — a malicious peer can fabricate
   * one attributed to anyone. The UI marks these so they're never mistaken for a
   * verified-author live message, and they're excluded from the unread count.
   */
  replayed?: boolean
}

export interface FileItem {
  kind: 'file'
  id: string
  timestamp: number
  fromIdentity: string
  fromName: string
  isLocal: boolean
  fileName: string
  mimeType: string
  size?: number
  /** Object URL, set once the file is fully received (or immediately for local sends). */
  url?: string
  /** 0..1 transfer progress. */
  progress: number
}

export type ChatItem = TextItem | FileItem

function displayName(identity: string, name?: string): string {
  return name || identity.split('#')[0] || 'Guest'
}

/**
 * Unified chat timeline: text (LiveKit useChat) + P2P file transfers (byte streams),
 * merged and sorted by timestamp so files render as inline cards. No persistence,
 * no storage at rest — everything flows over the data channel (STYLE.md / Architecture).
 */
export function useChatMessages() {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const { chatMessages, send: sendChatText, isSending } = useChat()
  const [files, setFiles] = useState<FileItem[]>([])

  // Guarded data-channel publish. The chat hooks mount during the Connecting
  // phase (RoomView runs its hooks before the connected gate renders the call),
  // so the join-time sync-request timers below can fire before the transport is
  // up — and LiveKit's publishData throws ("Cannot read properties of undefined
  // (reading 'next')") when the engine isn't ready. Gate every broadcast on the
  // connected state and swallow any transient failure: the periodic sync-requests
  // and live resends recover, so a dropped not-ready publish is harmless and must
  // never surface as an unhandled error.
  const publish = useCallback(
    (
      send: (payload: Uint8Array, options: { reliable: boolean; topic: string }) => unknown,
      topic: string,
      data: object,
      reliable = true,
    ) => {
      if (room.state !== ConnectionState.Connected) return
      try {
        const r = send(new TextEncoder().encode(JSON.stringify(data)), { reliable, topic })
        if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(() => {})
      } catch {
        /* transport not ready / mid-reconnect — recovered by later sync + resends */
      }
    },
    [room],
  )

  const bumpUnread = useRoomStore((s) => s.bumpUnread)
  const panel = useRoomStore((s) => s.panel)
  const panelRef = useRef(panel)
  panelRef.current = panel

  // Receive incoming files. One handler per room, cleaned up on unmount.
  useEffect(() => {
    const handler: ByteStreamHandler = (reader, { identity }) => {
      const info = reader.info
      const id = info.id
      const sender = room.getParticipantByIdentity(identity)
      const item: FileItem = {
        kind: 'file',
        id,
        timestamp: info.timestamp,
        fromIdentity: identity,
        fromName: displayName(identity, sender?.name),
        isLocal: false,
        fileName: info.name,
        mimeType: info.mimeType,
        size: info.size,
        progress: 0,
      }
      setFiles((prev) => [...prev, item])
      reader.onProgress = (p) =>
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: p ?? f.progress } : f)))
      reader
        .readAll()
        .then((chunks) => {
          const blob = new Blob(chunks as BlobPart[], { type: info.mimeType })
          const url = URL.createObjectURL(blob)
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, url, progress: 1 } : f)))
        })
        .catch(() => {
          /* transfer aborted — leave the card at its last progress */
        })
    }

    room.registerByteStreamHandler(FILE_TOPIC, handler)
    return () => room.unregisterByteStreamHandler(FILE_TOPIC)
  }, [room])

  // Revoke object URLs on unmount to avoid leaks.
  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(() => {
    return () => {
      for (const f of filesRef.current) if (f.url) URL.revokeObjectURL(f.url)
    }
  }, [])

  const myIdentity = localParticipant.identity

  // Author edits: an overlay keyed by message id (the LiveKit chat history is
  // immutable, so we layer the new body on top at render). Broadcast like pins,
  // with the same late-joiner replay so everyone converges.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const editsRef = useRef<Record<string, string>>({})
  editsRef.current = edits

  // Chat history replayed by peers on (re)join (text messages sent before we were
  // connected). Disjoint by id from the live `chatMessages` we receive directly.
  const [history, setHistory] = useState<TextItem[]>([])
  // id → author identity for every message THIS session has. Reaction/edit
  // handlers gate on it: anything for an unknown id (e.g. a message from before
  // we rejoined) is dropped, so stale overlays can't bleed across sessions.
  // Populated synchronously in the items memo (not an effect) so a reaction that
  // lands right after its message isn't wrongly dropped by a stale map.
  const authorRef = useRef<Record<string, string>>({})
  // Full text timeline (history + live, edits applied) — read by the history
  // responder so it can replay everything it knows, not just its own messages.
  const replayRef = useRef<TextItem[]>([])

  const items = useMemo<ChatItem[]>(() => {
    const authors: Record<string, string> = {}
    const liveIds = new Set<string>()
    const text: TextItem[] = chatMessages.map((m) => {
      const decoded = decodeText(m.message)
      const id = m.id ?? `${m.timestamp}-${m.from?.identity ?? ''}`
      const edited = edits[id]
      authors[id] = m.from?.identity ?? ''
      liveIds.add(id)
      return {
        kind: 'text',
        id,
        timestamp: m.timestamp,
        fromIdentity: m.from?.identity ?? '',
        fromName: displayName(m.from?.identity ?? '', m.from?.name),
        isLocal: m.from?.identity === myIdentity,
        text: edited ?? decoded.text,
        replyTo: decoded.replyTo,
        edited: edited !== undefined,
      }
    })
    // Replayed history, minus anything we also have live; edits overlay here too.
    const hist: TextItem[] = history
      .filter((h) => !liveIds.has(h.id))
      .map((h) => {
        const edited = edits[h.id]
        authors[h.id] = h.fromIdentity
        return {
          ...h,
          isLocal: h.fromIdentity === myIdentity,
          text: edited ?? h.text,
          edited: edited !== undefined || h.edited,
        }
      })
    for (const f of files) authors[f.id] = f.fromIdentity
    authorRef.current = authors
    const all = [...hist, ...text, ...files].sort((a, b) => a.timestamp - b.timestamp)
    replayRef.current = all.filter((i): i is TextItem => i.kind === 'text').slice(-HISTORY_LIMIT)
    return all
  }, [chatMessages, files, myIdentity, edits, history])

  const sendEditRef = useRef<((data: object) => void) | null>(null)
  const { send: sendEdit } = useDataChannel(EDIT_TOPIC, (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | { kind: 'sync-request' }
        | { kind?: 'edit'; id: string; text: string }
      if ('kind' in d && d.kind === 'sync-request') {
        for (const [id, text] of Object.entries(editsRef.current)) {
          if (authorRef.current[id] === myIdentity) sendEditRef.current?.({ kind: 'edit', id, text })
        }
        return
      }
      if ('id' in d) {
        // Ignore edits for messages we don't have this session (same cross-rejoin
        // ghost problem as reactions), and only honor an edit from the message's
        // original author.
        const author = authorRef.current[d.id]
        if (author === undefined) return
        if (msg.from?.identity && author !== msg.from.identity) return
        setEdits((prev) => ({ ...prev, [d.id]: d.text }))
      }
    } catch {
      /* malformed — ignore */
    }
  })

  const broadcastEdit = useCallback((data: object) => publish(sendEdit, EDIT_TOPIC, data), [publish, sendEdit])
  sendEditRef.current = broadcastEdit

  useEffect(() => {
    const t = window.setTimeout(() => broadcastEdit({ kind: 'sync-request' }), 800)
    return () => window.clearTimeout(t)
  }, [broadcastEdit])

  /** Author edits the body of their own text message (reply quote is preserved). */
  const editMessage = useCallback(
    (id: string, text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setEdits((prev) => ({ ...prev, [id]: trimmed }))
      broadcastEdit({ kind: 'edit', id, text: trimmed })
    },
    [broadcastEdit],
  )

  // Chat-history sync: on (re)join, ask the room to replay the timeline so you
  // see what was said before you connected (the common "I left and came back"
  // case). Peers still present replay the text messages they hold; we dedupe by
  // id. No server storage — if the room is empty there's no one to replay, which
  // keeps the "nothing stored at rest" property. Mirrors the pin/reaction sync.
  interface HistoryWireItem {
    id: string
    identity: string
    name: string
    ts: number
    text: string
    replyName?: string
    replyText?: string
    replyId?: string
    edited?: boolean
  }
  const sendHistoryRef = useRef<((data: object) => void) | null>(null)
  const { send: sendHistory } = useDataChannel(HISTORY_TOPIC, (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | { kind: 'request' }
        | { kind: 'history'; items: HistoryWireItem[] }
      if (d.kind === 'request') {
        if (replayRef.current.length === 0) return
        const items: HistoryWireItem[] = replayRef.current.map((it) => ({
          id: it.id,
          identity: it.fromIdentity,
          name: it.fromName,
          ts: it.timestamp,
          text: it.text,
          replyName: it.replyTo?.name,
          replyText: it.replyTo?.text,
          replyId: it.replyTo?.id,
          edited: it.edited,
        }))
        sendHistoryRef.current?.({ kind: 'history', items })
        return
      }
      if (d.kind === 'history' && Array.isArray(d.items)) {
        setHistory((prev) => {
          const have = new Set(prev.map((h) => h.id))
          const additions: TextItem[] = []
          for (const e of d.items) {
            if (!e.id || have.has(e.id)) continue
            have.add(e.id)
            additions.push({
              kind: 'text',
              id: e.id,
              timestamp: e.ts,
              fromIdentity: e.identity,
              fromName: e.name,
              isLocal: e.identity === myIdentity,
              text: e.text,
              replyTo:
                e.replyName || e.replyText
                  ? { name: e.replyName ?? '', text: e.replyText ?? '', id: e.replyId }
                  : undefined,
              edited: e.edited,
              // Peer-replayed → author identity is unverified (see TextItem.replayed).
              replayed: true,
            })
          }
          if (additions.length === 0) return prev
          return [...prev, ...additions].slice(-HISTORY_LIMIT)
        })
      }
    } catch {
      /* malformed — ignore */
    }
  })

  const broadcastHistory = useCallback(
    (data: object) => publish(sendHistory, HISTORY_TOPIC, data),
    [publish, sendHistory],
  )
  sendHistoryRef.current = broadcastHistory

  // Request a replay shortly after join (let the data channel settle first).
  useEffect(() => {
    const t = window.setTimeout(() => broadcastHistory({ kind: 'request' }), 900)
    return () => window.clearTimeout(t)
  }, [broadcastHistory])

  // Shared pins (Slack model): broadcast pin/unpin over the data channel so the
  // pinned bar matches for everyone. Ephemeral, like the rest of chat.
  const [pinned, setPinned] = useState<PinnedMessage[]>([])
  // Mirror for the data-channel handler (avoids a stale closure on `pinned`).
  const pinnedRef = useRef<PinnedMessage[]>([])
  pinnedRef.current = pinned

  const sendPinRef = useRef<((data: object) => void) | null>(null)
  const { send: sendPin } = useDataChannel(PIN_TOPIC, (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | { kind: 'sync-request' }
        | (PinnedMessage & { kind?: 'pin'; pinned: boolean })
      // A late joiner asked for the current pins — replay mine so they catch up.
      if ('kind' in d && d.kind === 'sync-request') {
        for (const p of pinnedRef.current) sendPinRef.current?.({ kind: 'pin', ...p, pinned: true })
        return
      }
      setPinned((prev) => {
        if (!d.pinned) return prev.filter((p) => p.id !== d.id)
        if (prev.some((p) => p.id === d.id)) return prev
        return [...prev, { id: d.id, name: d.name, text: d.text, timestamp: d.timestamp }]
      })
    } catch {
      /* malformed — ignore */
    }
  })

  const broadcastPin = useCallback((data: object) => publish(sendPin, PIN_TOPIC, data), [publish, sendPin])
  sendPinRef.current = broadcastPin

  // On entry, ask peers to replay their pins so the pinned bar isn't empty for
  // someone who joined after the pins were set. (Small delay lets the data
  // channel settle after connect.)
  useEffect(() => {
    const t = window.setTimeout(() => broadcastPin({ kind: 'sync-request' }), 800)
    return () => window.clearTimeout(t)
  }, [broadcastPin])

  const togglePin = useCallback(
    (item: ChatItem) => {
      const isPinned = pinnedRef.current.some((p) => p.id === item.id)
      const text = item.kind === 'text' ? plainText(item.text) : item.fileName
      const entry: PinnedMessage = { id: item.id, name: item.fromName, text, timestamp: item.timestamp }
      setPinned((prev) => (isPinned ? prev.filter((p) => p.id !== item.id) : [...prev, entry]))
      broadcastPin({ kind: 'pin', ...entry, pinned: !isPinned })
    },
    [broadcastPin],
  )

  // Shared emoji reactions (Slack/Discord model): toggle events broadcast over the
  // data channel; each client owns *its own* reactions and replays them when a
  // late joiner asks (sync-request), so everyone converges. Ephemeral like chat.
  const [reactions, setReactions] = useState<ReactionMap>({})
  const reactionsRef = useRef<ReactionMap>({})
  reactionsRef.current = reactions

  // Pure add/remove of one identity from one (message, emoji) bucket.
  function applyReaction(map: ReactionMap, messageId: string, emoji: string, identity: string, added: boolean): ReactionMap {
    const forMsg = { ...(map[messageId] ?? {}) }
    const by = new Set(forMsg[emoji] ?? [])
    if (added) by.add(identity)
    else by.delete(identity)
    if (by.size > 0) forMsg[emoji] = [...by]
    else delete forMsg[emoji]
    const next = { ...map, [messageId]: forMsg }
    if (Object.keys(forMsg).length === 0) delete next[messageId]
    return next
  }

  const sendReactionRef = useRef<((data: object) => void) | null>(null)
  const { send: sendReactionMsg } = useDataChannel(REACTION_TOPIC, (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | { kind: 'sync-request' }
        | { kind?: 'react'; messageId: string; emoji: string; identity: string; added: boolean }
      // Late joiner catching up — replay only the reactions I own.
      if ('kind' in d && d.kind === 'sync-request') {
        for (const [messageId, byEmoji] of Object.entries(reactionsRef.current)) {
          for (const [emoji, ids] of Object.entries(byEmoji)) {
            if (ids.includes(myIdentity)) {
              sendReactionRef.current?.({ kind: 'react', messageId, emoji, identity: myIdentity, added: true })
            }
          }
        }
        return
      }
      if ('messageId' in d) {
        // Only apply reactions to messages THIS session actually received. A
        // reaction to a chat from before we (re)joined references a message we
        // don't have — applying it leaves a ghost that bleeds across rejoins
        // (you rejoin under a new name, have no history, yet keep getting
        // reactions for your old messages). Drop those.
        if (!(d.messageId in authorRef.current)) return
        setReactions((prev) => applyReaction(prev, d.messageId, d.emoji, d.identity, d.added))
      }
    } catch {
      /* malformed — ignore */
    }
  })

  const broadcastReaction = useCallback(
    (data: object) => publish(sendReactionMsg, REACTION_TOPIC, data),
    [publish, sendReactionMsg],
  )
  sendReactionRef.current = broadcastReaction

  // Ask peers to replay their reactions on entry (same late-join handshake as pins).
  useEffect(() => {
    const t = window.setTimeout(() => broadcastReaction({ kind: 'sync-request' }), 800)
    return () => window.clearTimeout(t)
  }, [broadcastReaction])

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      const had = reactionsRef.current[messageId]?.[emoji]?.includes(myIdentity) ?? false
      setReactions((prev) => applyReaction(prev, messageId, emoji, myIdentity, !had))
      broadcastReaction({ kind: 'react', messageId, emoji, identity: myIdentity, added: !had })
    },
    [broadcastReaction, myIdentity],
  )

  // Typing indicator: ephemeral pings broadcast while composing, others render
  // "… is typing". Each ping carries a fresh timestamp; entries self-expire after
  // TYPING_TTL_MS so a typer who closes their tab doesn't get stuck "typing".
  const myName = displayName(localParticipant.identity, localParticipant.name)
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({})

  const { send: sendTypingMsg } = useDataChannel(TYPING_TOPIC, (msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as {
        identity: string
        name: string
        typing: boolean
      }
      // Key off the unforgeable sender identity, NOT the payload's claimed
      // identity — otherwise a peer could spoof "X is typing" for someone else.
      const from = msg.from?.identity
      if (!from || from === myIdentity) return
      setTyping((prev) => {
        if (!d.typing) {
          if (!prev[from]) return prev
          const next = { ...prev }
          delete next[from]
          return next
        }
        return { ...prev, [from]: { name: d.name, at: Date.now() } }
      })
    } catch {
      /* malformed — ignore */
    }
  })

  // Drop stale typers (no fresh ping within the TTL) on a slow tick.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTyping((prev) => {
        const now = Date.now()
        let changed = false
        const next: typeof prev = {}
        for (const [id2, v] of Object.entries(prev)) {
          if (now - v.at < TYPING_TTL_MS) next[id2] = v
          else changed = true
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Throttle outgoing "typing: true" pings (~1.5s) and auto-send "typing: false"
  // after a short idle so the indicator clears on its own.
  const lastTypingSent = useRef(0)
  const stopTypingTimer = useRef<number | undefined>(undefined)
  const broadcastTyping = useCallback(
    (isTyping: boolean) =>
      publish(sendTypingMsg, TYPING_TOPIC, { identity: myIdentity, name: myName, typing: isTyping }, false),
    [publish, sendTypingMsg, myIdentity, myName],
  )

  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now
      broadcastTyping(true)
    }
    window.clearTimeout(stopTypingTimer.current)
    stopTypingTimer.current = window.setTimeout(() => {
      lastTypingSent.current = 0
      broadcastTyping(false)
    }, 3000)
  }, [broadcastTyping])

  const stopTyping = useCallback(() => {
    window.clearTimeout(stopTypingTimer.current)
    if (lastTypingSent.current) {
      lastTypingSent.current = 0
      broadcastTyping(false)
    }
  }, [broadcastTyping])

  const typingNames = useMemo(
    () => Object.values(typing).map((v) => v.name),
    [typing],
  )

  // Notify on new remote messages while chat is closed: bump the control bar's
  // unread badge, play the message chime, and surface a toast (the same
  // cross-cutting pattern used for join/leave/hand-raise in useCallSounds) —
  // the toast matters because the control bar itself auto-hides on mobile, so
  // the badge alone can be sitting off-screen when a message actually arrives.
  // Tracked by id (not a running count) so a burst that arrives out of render
  // order still notifies exactly once per message. Peer-replayed history is
  // excluded: a late-join sync can inject a batch of old messages at once,
  // which would otherwise spam notifications for things the user never missed
  // (they predate the join).
  const notifiedIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = items.filter(
      (i) => !i.isLocal && !(i.kind === 'text' && i.replayed) && !notifiedIds.current.has(i.id),
    )
    if (fresh.length === 0) return
    for (const i of fresh) notifiedIds.current.add(i.id)
    if (panelRef.current === 'chat') return
    bumpUnread(fresh.length)
    sounds.message()
    const last = fresh[fresh.length - 1]
    // A file item enters `items` as soon as the transfer starts (progress 0),
    // not once it's received — this notification fires at that same moment
    // (there's no follow-up once `notifiedIds` has the id), so it must not
    // claim the file already arrived.
    const preview =
      last.kind === 'text' ? plainText(last.text) : `Sending ${last.fileName}…`
    toast(`${last.fromName}: ${preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}`, 'info')
  }, [items, bumpUnread])

  /** Send a chat message. Returns false if the transport rejected it (e.g. sent
   *  mid-reconnect) so the composer can keep the text + tell the user, instead of
   *  silently dropping a real message (the publish() swallow was fine for typing
   *  pings, not for an actual send). */
  const sendText = useCallback(
    async (text: string, replyTo?: ReplyRef): Promise<boolean> => {
      const trimmed = text.trim()
      if (!trimmed) return true
      try {
        await sendChatText(encodeText(trimmed, replyTo))
        return true
      } catch {
        return false
      }
    },
    [sendChatText],
  )

  const sendFile = useCallback(
    async (file: File) => {
      const mimeType = file.type || 'application/octet-stream'
      const localId = `local-${file.name}-${file.size}-${file.lastModified}`
      const url = URL.createObjectURL(file)
      setFiles((prev) => [
        ...prev,
        {
          kind: 'file',
          id: localId,
          timestamp: Date.now(),
          fromIdentity: localParticipant.identity,
          fromName: displayName(localParticipant.identity, localParticipant.name),
          isLocal: true,
          fileName: file.name,
          mimeType,
          size: file.size,
          url,
          progress: 1,
        },
      ])
      try {
        await localParticipant.sendFile(file, { topic: FILE_TOPIC, mimeType })
      } catch {
        setFiles((prev) => prev.filter((f) => f.id !== localId))
        URL.revokeObjectURL(url)
      }
    },
    [localParticipant],
  )

  return {
    items,
    sendText,
    sendFile,
    isSending,
    pinned,
    togglePin,
    reactions,
    toggleReaction,
    myIdentity,
    typingNames,
    notifyTyping,
    stopTyping,
    editMessage,
  }
}
