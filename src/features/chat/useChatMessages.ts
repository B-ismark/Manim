import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat, useLocalParticipant, useRoomContext } from '@livekit/components-react'
import type { ByteStreamHandler } from 'livekit-client'
import { useRoomStore } from '@/store/useRoomStore'

/** Data-channel topic for P2P file transfer (no storage at rest — streams through the SFU). */
const FILE_TOPIC = 'mn.file'

export interface TextItem {
  kind: 'text'
  id: string
  timestamp: number
  fromIdentity: string
  fromName: string
  isLocal: boolean
  text: string
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
    const text: TextItem[] = chatMessages.map((m) => ({
      kind: 'text',
      id: m.id ?? `${m.timestamp}-${m.from?.identity ?? ''}`,
      timestamp: m.timestamp,
      fromIdentity: m.from?.identity ?? '',
      fromName: displayName(m.from?.identity ?? '', m.from?.name),
      isLocal: m.from?.identity === localId,
      text: m.message,
    }))
    return [...text, ...files].sort((a, b) => a.timestamp - b.timestamp)
  }, [chatMessages, files, localParticipant.identity])

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
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed) void sendChatText(trimmed)
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

  return { items, sendText, sendFile, isSending }
}
