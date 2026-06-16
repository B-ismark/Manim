import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react'
import type { ByteStreamHandler } from 'livekit-client'
import { useRoomStore } from '@/store/useRoomStore'

/** Data-channel topic for P2P file transfer (no storage at rest — streams through the SFU). */
const FILE_TOPIC = 'mn.file'
/** Pin broadcast topic — pins are shared across the room (Slack model). */
const PIN_TOPIC = 'mn.pin'
/** Emoji-reaction broadcast topic — per-message reactions, shared room-wide. */
const REACTION_TOPIC = 'mn.reaction'
/** Message-edit topic — author edits broadcast to everyone (overlay on the body). */
const EDIT_TOPIC = 'mn.edit'
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
  return REPLY_START + JSON.stringify({ n: replyTo.name, t: replyTo.text.slice(0, 160) }) + REPLY_END + text
}
function decodeText(raw: string): { text: string; replyTo?: ReplyRef } {
  if (!raw.startsWith(REPLY_START)) return { text: raw }
  const end = raw.indexOf(REPLY_END)
  if (end < 0) return { text: raw }
  try {
    const meta = JSON.parse(raw.slice(REPLY_START.length, end)) as { n?: string; t?: string }
    return { text: raw.slice(end + 1), replyTo: { name: meta.n ?? '', text: meta.t ?? '' } }
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
  // id → author identity for every message THIS session has. Reaction/edit
  // handlers gate on it: anything for an unknown id (e.g. a message from before
  // we rejoined) is dropped, so stale overlays can't bleed across sessions.
  // Populated synchronously in the items memo (not an effect) so a reaction that
  // lands right after its message isn't wrongly dropped by a stale map.
  const authorRef = useRef<Record<string, string>>({})

  const items = useMemo<ChatItem[]>(() => {
    const authors: Record<string, string> = {}
    const text: TextItem[] = chatMessages.map((m) => {
      const decoded = decodeText(m.message)
      const id = m.id ?? `${m.timestamp}-${m.from?.identity ?? ''}`
      const edited = edits[id]
      authors[id] = m.from?.identity ?? ''
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
    for (const f of files) authors[f.id] = f.fromIdentity
    authorRef.current = authors
    return [...text, ...files].sort((a, b) => a.timestamp - b.timestamp)
  }, [chatMessages, files, myIdentity, edits])

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

  const broadcastEdit = useCallback(
    (data: object) =>
      void sendEdit(new TextEncoder().encode(JSON.stringify(data)), { reliable: true, topic: EDIT_TOPIC }),
    [sendEdit],
  )
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

  const broadcastPin = useCallback(
    (data: object) =>
      void sendPin(new TextEncoder().encode(JSON.stringify(data)), { reliable: true, topic: PIN_TOPIC }),
    [sendPin],
  )
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
      const text = item.kind === 'text' ? item.text : item.fileName
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
    (data: object) =>
      void sendReactionMsg(new TextEncoder().encode(JSON.stringify(data)), { reliable: true, topic: REACTION_TOPIC }),
    [sendReactionMsg],
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
      if (d.identity === myIdentity) return
      setTyping((prev) => {
        if (!d.typing) {
          if (!prev[d.identity]) return prev
          const next = { ...prev }
          delete next[d.identity]
          return next
        }
        return { ...prev, [d.identity]: { name: d.name, at: Date.now() } }
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
      void sendTypingMsg(
        new TextEncoder().encode(JSON.stringify({ identity: myIdentity, name: myName, typing: isTyping })),
        { reliable: false, topic: TYPING_TOPIC },
      ),
    [sendTypingMsg, myIdentity, myName],
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

  // Track remote-message count → bump unread badge while chat is closed.
  const prevRemote = useRef(0)
  useEffect(() => {
    const remote = items.reduce((n, i) => (i.isLocal ? n : n + 1), 0)
    if (remote > prevRemote.current && panelRef.current !== 'chat') {
      bumpUnread(remote - prevRemote.current)
    }
    prevRemote.current = remote
  }, [items, bumpUnread])

  const sendText = useCallback(
    (text: string, replyTo?: ReplyRef) => {
      const trimmed = text.trim()
      if (trimmed) void sendChatText(encodeText(trimmed, replyTo))
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
