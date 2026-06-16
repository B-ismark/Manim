import { useEffect, useRef, useState } from 'react'
import { Avatar, IconButton, Popover, Sheet } from '@/components/primitives'
import { AttachIcon, CloseIcon, DownloadIcon, GifIcon, PinIcon, ReplyIcon, SendIcon } from '@/components/icons'
import {
  type useChatMessages,
  type ChatItem,
  type FileItem,
  type ReplyRef,
  type PinnedMessage,
} from '@/features/chat/useChatMessages'

/** Chat state lives in RoomView (persists across panel open/close) and is passed in. */
export type ChatApi = ReturnType<typeof useChatMessages>
import { isImage, IMAGE_INLINE_MAX_BYTES, looksLikeImageUrl, uploadError } from '@/features/chat/limits'
import { GifPicker, gifEnabled } from '@/islands/GifPicker'
import { useIsTouch } from '@/lib/useIsTouch'
import { cn } from '@/lib/cn'

/** Short label for what a chat item contains — used in reply chips + pins. */
function previewOf(item: ChatItem): string {
  return item.kind === 'text' ? item.text : item.fileName
}

function humanSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Chat timeline + composer. Images preview inline; files + GIFs supported (STYLE.md §5 Tier-1). */
export function ChatPanel({ chat }: { chat: ChatApi }) {
  const { items, sendText, sendFile, pinned, togglePin } = chat
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null)
  const narrow = useIsTouch()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  function submit() {
    if (!draft.trim()) return
    sendText(draft, replyTo ?? undefined)
    setDraft('')
    setReplyTo(null)
  }

  function startReply(item: ChatItem) {
    setReplyTo({ name: item.isLocal ? 'You' : item.fromName, text: previewOf(item) })
    inputRef.current?.focus()
  }

  const isPinned = (id: string) => pinned.some((p) => p.id === id)

  function onPickFiles(files: FileList | null) {
    if (!files) return
    for (const f of Array.from(files)) {
      const err = uploadError(f)
      if (err) {
        setError(err)
        continue
      }
      void sendFile(f)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-line px-3 py-1.5 text-center text-[11px] text-ink-subtle">
        Messages are visible only to people in this call.
      </p>

      {pinned.length > 0 && (
        <div className="shrink-0 space-y-1 border-b border-line bg-sunken/60 px-3 py-2">
          {pinned.map((p) => (
            <PinnedRow key={p.id} pin={p} onUnpin={() => togglePin({ kind: 'text', id: p.id, fromName: p.name, text: p.text, timestamp: p.timestamp, fromIdentity: '', isLocal: false })} />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No messages yet</p>
              <p className="mt-1 text-xs text-ink-muted">Say hi or share a file.</p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <MessageRow
              key={item.id}
              item={item}
              pinned={isPinned(item.id)}
              onReply={() => startReply(item)}
              onTogglePin={() => togglePin(item)}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mx-3 mb-1 flex items-center justify-between gap-2 rounded-field bg-sunken px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-ink-muted hover:text-ink">
            Dismiss
          </button>
        </div>
      )}

      {replyTo && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-field border-l-2 border-accent bg-sunken px-3 py-1.5">
          <ReplyIcon className="size-3.5 shrink-0 text-ink-subtle" />
          <div className="min-w-0 flex-1 text-xs">
            <span className="font-medium text-ink">Replying to {replyTo.name}</span>
            <p className="truncate text-ink-subtle">{replyTo.text}</p>
          </div>
          <IconButton size="sm" tone="neutral" label="Cancel reply" icon={<CloseIcon />} onClick={() => setReplyTo(null)} />
        </div>
      )}

      <form
        className="flex shrink-0 items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onPickFiles(e.target.files)}
        />
        <IconButton
          type="button"
          size="sm"
          label="Attach a file"
          icon={<AttachIcon />}
          onClick={() => fileInputRef.current?.click()}
        />
        {gifEnabled &&
          (narrow ? (
            <>
              <IconButton
                type="button"
                size="sm"
                label="Send a GIF"
                icon={<GifIcon />}
                active={gifOpen}
                onClick={() => setGifOpen(true)}
              />
              <Sheet open={gifOpen} onOpenChange={setGifOpen} side="bottom" title="Send a GIF">
                <GifPicker
                  onSelect={(url) => {
                    sendText(url)
                    setGifOpen(false)
                  }}
                />
              </Sheet>
            </>
          ) : (
            <Popover
              open={gifOpen}
              onOpenChange={setGifOpen}
              side="top"
              align="start"
              trigger={
                <IconButton type="button" size="sm" label="Send a GIF" icon={<GifIcon />} active={gifOpen} />
              }
            >
              <div className="w-72">
                <GifPicker
                  onSelect={(url) => {
                    sendText(url)
                    setGifOpen(false)
                  }}
                />
              </div>
            </Popover>
          ))}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Message"
          aria-label="Message"
          className={cn(
            // Cap relative to viewport on phones so a multi-line draft doesn't
            // crowd out the timeline when the on-screen keyboard is up.
            'max-h-[20dvh] min-h-9 flex-1 resize-none rounded-field bg-sunken px-3 py-2 text-sm sm:max-h-28',
            'placeholder:text-ink-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        />
        <IconButton
          type="submit"
          size="sm"
          tone="accent"
          label="Send message"
          icon={<SendIcon />}
          disabled={!draft.trim()}
        />
      </form>
    </div>
  )
}

function MessageRow({
  item,
  pinned,
  onReply,
  onTogglePin,
}: {
  item: ChatItem
  pinned: boolean
  onReply: () => void
  onTogglePin: () => void
}) {
  const replyTo = item.kind === 'text' ? item.replyTo : undefined
  return (
    <div className="group relative flex gap-2.5">
      <Avatar name={item.fromName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{item.isLocal ? 'You' : item.fromName}</span>
          <span className="text-xs text-ink-subtle">{timeOf(item.timestamp)}</span>
          {pinned && <PinIcon className="size-3 text-accent" aria-label="Pinned" />}
        </div>

        {/* Quoted message this one replies to. */}
        {replyTo && (
          <div className="mt-1 border-l-2 border-line-strong pl-2">
            <p className="text-[11px] font-medium text-ink-muted">{replyTo.name}</p>
            <p className="truncate text-xs text-ink-subtle">{replyTo.text}</p>
          </div>
        )}

        {item.kind === 'text' ? (
          looksLikeImageUrl(item.text) ? (
            <ImageBubble src={item.text} />
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{item.text}</p>
          )
        ) : (
          <FileMessage file={item} />
        )}
      </div>

      {/* Hover (desktop) / always-on (touch) message actions. */}
      <div className="absolute right-0 top-0 flex gap-0.5 rounded-control bg-surface p-0.5 opacity-0 shadow-pop transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton size="sm" tone="neutral" label="Reply" icon={<ReplyIcon />} onClick={onReply} />
        <IconButton
          size="sm"
          tone={pinned ? 'accent' : 'neutral'}
          label={pinned ? 'Unpin' : 'Pin'}
          icon={<PinIcon />}
          active={pinned}
          onClick={onTogglePin}
        />
      </div>
    </div>
  )
}

/** A row in the pinned bar at the top of chat. */
function PinnedRow({ pin, onUnpin }: { pin: PinnedMessage; onUnpin: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <PinIcon className="size-3.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-xs">
        <span className="font-medium text-ink">{pin.name}</span>
        <span className="ml-1.5 text-ink-subtle">{pin.text}</span>
      </div>
      <button
        type="button"
        onClick={onUnpin}
        aria-label="Unpin message"
        className="shrink-0 text-ink-subtle hover:text-ink [&_svg]:size-3.5"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

/** Inline image / GIF preview. `download` is set for received files (blob URLs). */
function ImageBubble({ src, download }: { src: string; download?: string }) {
  return (
    <div className="mt-1">
      <a href={src} target="_blank" rel="noreferrer" className="inline-block">
        <img
          src={src}
          alt={download || 'shared image'}
          loading="lazy"
          className="max-h-60 max-w-full rounded-field object-contain"
        />
      </a>
      {download && (
        <a
          href={src}
          download={download}
          className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink [&_svg]:size-3.5"
        >
          <DownloadIcon /> Download
        </a>
      )}
    </div>
  )
}

function FileMessage({ file }: { file: FileItem }) {
  const done = file.progress >= 1 && file.url
  // Small images preview inline; large images (and other files) show a card.
  const inlineImage = done && isImage(file.mimeType) && (file.size ?? 0) <= IMAGE_INLINE_MAX_BYTES

  if (inlineImage && file.url) {
    return <ImageBubble src={file.url} download={file.fileName} />
  }

  return (
    <div className="mt-1 flex items-center gap-3 rounded-field border border-line bg-raised p-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-field bg-accent-soft text-accent">
        <DownloadIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.fileName}</p>
        <p className="text-xs text-ink-muted">
          {humanSize(file.size)}
          {done && isImage(file.mimeType) ? ' · large image — download to view' : ''}
        </p>
        {!done && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur-fast)]"
              style={{ width: `${Math.round(file.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {done && (
        <a
          href={file.url}
          download={file.fileName}
          aria-label={`Download ${file.fileName}`}
          title={`Download ${file.fileName}`}
          className="grid size-9 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-sunken hover:text-ink [&_svg]:size-4"
        >
          <DownloadIcon />
        </a>
      )}
    </div>
  )
}
