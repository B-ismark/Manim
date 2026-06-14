import { useEffect, useRef, useState } from 'react'
import { Avatar, IconButton, Popover } from '@/components/primitives'
import { AttachIcon, DownloadIcon, GifIcon, SendIcon } from '@/components/icons'
import { useChatMessages, type ChatItem, type FileItem } from '@/features/chat/useChatMessages'
import { isImage, IMAGE_INLINE_MAX_BYTES, looksLikeImageUrl, uploadError } from '@/features/chat/limits'
import { GifPicker, gifEnabled } from '@/islands/GifPicker'
import { cn } from '@/lib/cn'

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
export function ChatPanel() {
  const { items, sendText, sendFile } = useChatMessages()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  function submit() {
    if (!draft.trim()) return
    sendText(draft)
    setDraft('')
  }

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
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No messages yet</p>
              <p className="mt-1 text-xs text-ink-muted">Say hello, share a file or a GIF.</p>
            </div>
          </div>
        ) : (
          items.map((item) => <MessageRow key={item.id} item={item} />)
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
        {gifEnabled && (
          <Popover
            open={gifOpen}
            onOpenChange={setGifOpen}
            side="top"
            align="start"
            trigger={
              <IconButton type="button" size="sm" label="Send a GIF" icon={<GifIcon />} active={gifOpen} />
            }
          >
            <GifPicker
              onSelect={(url) => {
                sendText(url)
                setGifOpen(false)
              }}
            />
          </Popover>
        )}
        <textarea
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
            'max-h-28 min-h-9 flex-1 resize-none rounded-field bg-sunken px-3 py-2 text-sm',
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

function MessageRow({ item }: { item: ChatItem }) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={item.fromName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{item.isLocal ? 'You' : item.fromName}</span>
          <span className="text-xs text-ink-subtle">{timeOf(item.timestamp)}</span>
        </div>
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
