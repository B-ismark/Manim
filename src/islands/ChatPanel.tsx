import { useEffect, useRef, useState } from 'react'
import { Avatar, IconButton } from '@/components/primitives'
import { AttachIcon, DownloadIcon, SendIcon } from '@/components/icons'
import { useChatMessages, type ChatItem, type FileItem } from '@/features/chat/useChatMessages'
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

/** Chat timeline + composer. Files render inline as cards (STYLE.md §5 Tier-1). */
export function ChatPanel() {
  const { items, sendText, sendFile } = useChatMessages()
  const [draft, setDraft] = useState('')
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
    for (const f of Array.from(files)) void sendFile(f)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No messages yet</p>
              <p className="mt-1 text-xs text-ink-muted">Say hello or share a file.</p>
            </div>
          </div>
        ) : (
          items.map((item) => <MessageRow key={item.id} item={item} />)
        )}
        <div ref={endRef} />
      </div>

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
            'placeholder:text-ink-subtle focus:outline-none',
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
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{item.text}</p>
        ) : (
          <FileCard file={item} />
        )}
      </div>
    </div>
  )
}

function FileCard({ file }: { file: FileItem }) {
  const done = file.progress >= 1 && file.url
  return (
    <div className="mt-1 flex items-center gap-3 rounded-field border border-line bg-raised p-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-field bg-accent-soft text-accent">
        <DownloadIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.fileName}</p>
        <p className="text-xs text-ink-muted">{humanSize(file.size)}</p>
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
