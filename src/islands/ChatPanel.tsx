import { useEffect, useRef, useState } from 'react'
import { Avatar, IconButton, Popover, Sheet } from '@/components/primitives'
import { AttachIcon, CloseIcon, DownloadIcon, GifIcon, PinIcon, ReactionIcon, ReplyIcon, SendIcon } from '@/components/icons'
import { EmojiPicker } from '@/islands/EmojiPicker'
import type { ReactionMap } from '@/features/chat/useChatMessages'
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
import { renderMarkdown } from '@/lib/formatText'
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

/** Consecutive messages from the same sender within a short window collapse into
 *  one visual group (Meet / Slack / WhatsApp convention): the avatar + name +
 *  time render once for the run, follow-ups are just the bubble. A reply always
 *  breaks the group — it needs its own header for the quoted context to read. */
const GROUP_WINDOW_MS = 5 * 60 * 1000
function continuesGroup(prev: ChatItem | undefined, item: ChatItem): boolean {
  if (!prev) return false
  if (item.kind === 'text' && item.replyTo) return false
  return (
    prev.fromIdentity === item.fromIdentity &&
    prev.isLocal === item.isLocal &&
    item.timestamp - prev.timestamp < GROUP_WINDOW_MS
  )
}

/** Chat timeline + composer. Images preview inline; files + GIFs supported (STYLE.md §5 Tier-1). */
export function ChatPanel({ chat }: { chat: ChatApi }) {
  const { items, sendText, sendFile, pinned, togglePin, reactions, toggleReaction, myIdentity, typingNames, notifyTyping, stopTyping, editMessage } = chat
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

  // Grow the composer to fit the draft (up to the CSS max-height, after which it
  // scrolls). A rows=1 textarea otherwise stays one line tall and the rest
  // scrolls hidden inside it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  function submit() {
    if (!draft.trim()) return
    sendText(draft, replyTo ?? undefined)
    setDraft('')
    setReplyTo(null)
    stopTyping()
  }

  function onDraftChange(value: string) {
    setDraft(value)
    if (value.trim()) notifyTyping()
    else stopTyping()
  }

  // Wrap the current selection (or caret) in a markdown marker — the Cmd/Ctrl+B
  // (bold), +I (italic), +E (code) shortcuts. Restores the selection around the
  // wrapped text so you can keep typing.
  function wrapSelection(marker: string) {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + marker + draft.slice(start, end) + marker + draft.slice(end)
    onDraftChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + marker.length, end + marker.length)
    })
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      const marker = k === 'b' ? '**' : k === 'i' ? '_' : k === 'e' ? '`' : null
      if (marker) {
        e.preventDefault()
        wrapSelection(marker)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No messages yet</p>
              <p className="mt-1 text-xs text-ink-muted">Say hi or share a file.</p>
            </div>
          </div>
        ) : (
          items.map((item, i) => (
            <MessageRow
              key={item.id}
              item={item}
              grouped={continuesGroup(items[i - 1], item)}
              pinned={isPinned(item.id)}
              reactions={reactions[item.id]}
              myIdentity={myIdentity}
              onReact={(emoji) => toggleReaction(item.id, emoji)}
              onReply={() => startReply(item)}
              onTogglePin={() => togglePin(item)}
              onEdit={item.kind === 'text' && item.isLocal ? (text) => editMessage(item.id, text) : undefined}
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

      <TypingIndicator names={typingNames} />

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
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onComposerKeyDown}
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
  grouped,
  pinned,
  reactions,
  myIdentity,
  onReact,
  onReply,
  onTogglePin,
  onEdit,
}: {
  item: ChatItem
  /** True when this continues the previous sender's run — avatar/header collapse. */
  grouped: boolean
  pinned: boolean
  /** This message's reactions: emoji → identities who reacted. */
  reactions?: ReactionMap[string]
  myIdentity: string
  onReact: (emoji: string) => void
  onReply: () => void
  onTogglePin: () => void
  /** Defined only for your own text messages — edits the body in place. */
  onEdit?: (text: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const narrow = useIsTouch()
  const replyTo = item.kind === 'text' ? item.replyTo : undefined
  const react = (emoji: string) => {
    onReact(emoji)
    setPickerOpen(false)
  }
  const startEdit = () => {
    if (item.kind !== 'text') return
    setEditDraft(item.text)
    setEditing(true)
  }
  const saveEdit = () => {
    if (editDraft.trim()) onEdit?.(editDraft)
    setEditing(false)
  }
  return (
    <div className={cn('group relative flex gap-2.5', grouped ? 'mt-0.5' : 'mt-3 first:mt-0')}>
      {grouped ? (
        // Keep the bubble aligned with the grouped run (matches Avatar sm = size-8).
        <div className="w-8 shrink-0" aria-hidden />
      ) : (
        <Avatar name={item.fromName} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{item.isLocal ? 'You' : item.fromName}</span>
            <span className="text-xs text-ink-subtle">{timeOf(item.timestamp)}</span>
            {item.kind === 'text' && item.edited && (
              <span className="text-[11px] text-ink-subtle">(edited)</span>
            )}
            {pinned && <PinIcon className="size-3 text-accent" aria-label="Pinned" />}
          </div>
        )}

        {/* Quoted message this one replies to. */}
        {replyTo && (
          <div className="mt-1 border-l-2 border-line-strong pl-2">
            <p className="text-[11px] font-medium text-ink-muted">{replyTo.name}</p>
            <p className="truncate text-xs text-ink-subtle">{replyTo.text}</p>
          </div>
        )}

        {editing && item.kind === 'text' ? (
          <div className="mt-0.5 flex flex-col gap-1.5">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  saveEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
              rows={1}
              autoFocus
              aria-label="Edit message"
              className="max-h-28 min-h-9 w-full resize-none rounded-field bg-sunken px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={saveEdit} className="font-medium text-accent hover:underline">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-ink-muted hover:text-ink">
                Cancel
              </button>
              <span className="text-ink-subtle">Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : item.kind === 'text' ? (
          looksLikeImageUrl(item.text) ? (
            <ImageBubble src={item.text} />
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{renderMarkdown(item.text)}</p>
          )
        ) : (
          <FileMessage file={item} />
        )}

        <ReactionChips reactions={reactions} myIdentity={myIdentity} onReact={onReact} />
      </div>

      {/* Hover (desktop) / always-on (touch) message actions. */}
      <div className="absolute right-0 top-0 flex gap-0.5 rounded-control bg-surface p-0.5 opacity-0 shadow-pop transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        {narrow ? (
          <>
            <IconButton
              size="sm"
              tone="neutral"
              label="Add reaction"
              icon={<ReactionIcon />}
              active={pickerOpen}
              onClick={() => setPickerOpen(true)}
            />
            <Sheet open={pickerOpen} onOpenChange={setPickerOpen} side="bottom" title="Add reaction">
              <EmojiPicker onSelect={react} />
            </Sheet>
          </>
        ) : (
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            side="top"
            align="end"
            trigger={<IconButton size="sm" tone="neutral" label="Add reaction" icon={<ReactionIcon />} active={pickerOpen} />}
          >
            <EmojiPicker onSelect={react} />
          </Popover>
        )}
        <IconButton size="sm" tone="neutral" label="Reply" icon={<ReplyIcon />} onClick={onReply} />
        {onEdit && (
          <IconButton
            size="sm"
            tone="neutral"
            label="Edit message"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            }
            onClick={startEdit}
          />
        )}
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

/** "… is typing" line above the composer. Names collapse past two so it never
 *  grows unbounded. Three pulsing dots cue live activity (WhatsApp/Messenger). */
function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : 'Several people are typing'
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 text-xs text-ink-subtle" aria-live="polite">
      <span className="flex items-center gap-[3px]" aria-hidden>
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="size-[4px] animate-pulse rounded-full bg-current"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  )
}

/** Reaction pills under a message. Each shows the emoji + count; your own
 *  reactions are highlighted, and tapping a pill toggles yours (Slack/Discord). */
function ReactionChips({
  reactions,
  myIdentity,
  onReact,
}: {
  reactions?: ReactionMap[string]
  myIdentity: string
  onReact: (emoji: string) => void
}) {
  const entries = reactions ? Object.entries(reactions).filter(([, by]) => by.length > 0) : []
  if (entries.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.map(([emoji, by]) => {
        const mine = by.includes(myIdentity)
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-pressed={mine}
            aria-label={`${emoji} ${by.length}${mine ? ', you reacted' : ''}`}
            className={cn(
              'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none transition-colors',
              mine
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-sunken text-ink-muted hover:border-line-strong',
            )}
          >
            <span className="text-sm">{emoji}</span>
            <span className="tabular-nums">{by.length}</span>
          </button>
        )
      })}
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
