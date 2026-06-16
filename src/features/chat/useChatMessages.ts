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

  const items = useMemo<ChatItem[]>(() => {
    const localId = localParticipant.identity
    const text: TextItem[] = chatMessages.map((m) => {
      const decoded = decodeText(m.message)
      return {
        kind: 'text',
        id: m.id ?? `${m.timestamp}-${m.from?.identity ?? ''}`,
        timestamp: m.timestamp,
        fromIdentity: m.from?.identity ?? '',
        fromName: displayName(m.from?.identity ?? '', m.from?.name),
        isLocal: m.from?.identity === localId,
        text: decoded.text,
        replyTo: decoded.replyTo,
      }
    })
    return [...text, ...files].sort((a, b) => a.timestamp - b.timestamp)
  }, [chatMessages, files, localParticipant.identity])

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
  const myIdentity = localParticipant.identity
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

  return { items, sendText, sendFile, isSending, pinned, togglePin, reactions, toggleReaction, myIdentity }
}
