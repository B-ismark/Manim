import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Avatar, Button, IconButton, Popover, Sheet } from '@/components/primitives'
import { AttachIcon, CloseIcon, DownloadIcon, GifIcon, PinIcon, ReactionIcon, ReplyIcon, SendIcon } from '@/components/icons'
import { EmojiPicker } from '@/islands/EmojiPicker'
import { encodeMentions, mentionsIdentity, plainText, type MentionTarget } from '@/features/chat/mentions'
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
import { isImage, IMAGE_INLINE_MAX_BYTES, looksLikeImageUrl, isAutoLoadImageUrl, uploadError } from '@/features/chat/limits'
import { GifPicker, gifEnabled } from '@/islands/GifPicker'
import { useIsTouch } from '@/lib/useIsTouch'
import { renderRichText } from '@/lib/formatText'
import { cn } from '@/lib/cn'

/** A live mention candidate the composer can tag. */
interface MentionMatch {
  /** Index of the '@' that opened the query. */
  start: number
  /** Text typed after '@', up to the caret. */
  query: string
}

/** If the caret sits inside an `@query` token, return it (so the picker can open).
 *  The '@' must start the line or follow whitespace, and the query can't span a
 *  newline — matches the Slack/Discord trigger rule. */
function activeMention(value: string, caret: number): MentionMatch | null {
  const upto = value.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(upto[at - 1])) return null
  const query = upto.slice(at + 1)
  if (query.includes('\n') || query.length > 40) return null
  return { start: at, query }
}

/** Short label for what a chat item contains — used in reply chips + pins. Mentions
 *  are flattened to readable `@Name` (these surfaces don't run the rich renderer). */
function previewOf(item: ChatItem): string {
  return item.kind === 'text' ? plainText(item.text) : item.fileName
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

  // Everyone else in the call is taggable. Memoized so the picker filter is cheap.
  const participants = useParticipants()
  const mentionTargets = useMemo<MentionTarget[]>(
    () =>
      participants
        .filter((p) => p.identity !== myIdentity)
        .map((p) => ({ identity: p.identity, name: p.name || p.identity.split('#')[0] || 'Guest' }))
        .filter((t) => t.name),
    [participants, myIdentity],
  )

  // @-autocomplete state: the active `@query` under the caret + which suggestion
  // is highlighted for keyboard selection.
  const [mention, setMention] = useState<MentionMatch | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return mentionTargets.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 6)
  }, [mention, mentionTargets])
  const showMentions = mention !== null && suggestions.length > 0

  // Recompute the active mention from the live caret position (typing, clicks,
  // arrow keys). Reset the highlighted index whenever the query changes.
  function syncMention(el: HTMLTextAreaElement) {
    const next = activeMention(el.value, el.selectionStart ?? el.value.length)
    setMention(next)
    setMentionIdx(0)
  }

  // Replace the `@query` under the caret with the picked participant's name. The
  // wire-level encoding (identity) happens at send via encodeMentions.
  function pickMention(target: MentionTarget) {
    const el = inputRef.current
    if (!el || !mention) return
    const caret = el.selectionStart ?? draft.length
    const before = draft.slice(0, mention.start)
    const after = draft.slice(caret)
    const insert = `@${target.name} `
    const next = before + insert + after
    setDraft(next)
    setMention(null)
    const pos = before.length + insert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

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
    // Encode @mentions against the current roster just before sending so each
    // client can resolve who was tagged regardless of name changes.
    sendText(encodeMentions(draft, mentionTargets), replyTo ?? undefined)
    setDraft('')
    setReplyTo(null)
    setMention(null)
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
    // Mention picker owns the arrows / Enter / Tab / Esc while it's open.
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(suggestions[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
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

  // Stable so the memoized MessageList isn't invalidated on every ChatPanel
  // re-render (draft typing, participant speaking-state churn, etc.).
  const startReply = useCallback((item: ChatItem) => {
    setReplyTo({ name: item.isLocal ? 'You' : item.fromName, text: previewOf(item) })
    inputRef.current?.focus()
  }, [])

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
        <MessageList
          items={items}
          reactions={reactions}
          pinned={pinned}
          myIdentity={myIdentity}
          onReact={toggleReaction}
          onReply={startReply}
          onTogglePin={togglePin}
          onEdit={editMessage}
        />
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
        <div className="mx-3 mb-1 flex items-stretch gap-2.5 overflow-hidden rounded-field bg-sunken pr-1">
          {/* Full-height accent bar reads as a quote rail (Slack/WhatsApp). */}
          <span aria-hidden className="w-1 shrink-0 self-stretch rounded-full bg-accent" />
          <div className="min-w-0 flex-1 py-1.5">
            <span className="flex items-center gap-1 text-xs font-medium text-accent [&_svg]:size-3.5">
              <ReplyIcon />
              Replying to {replyTo.name}
            </span>
            <p className="mt-0.5 truncate text-xs text-ink-subtle">{replyTo.text}</p>
          </div>
          <IconButton size="sm" tone="neutral" label="Cancel reply" icon={<CloseIcon />} onClick={() => setReplyTo(null)} className="self-center" />
        </div>
      )}

      <form
        className="relative flex shrink-0 items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {showMentions && (
          <ul
            id="mention-listbox"
            role="listbox"
            aria-label="Mention a participant"
            className="absolute inset-x-3 bottom-full z-10 mb-2 max-h-48 overflow-y-auto rounded-field border border-line bg-surface py-1 shadow-pop"
          >
            {suggestions.map((t, i) => (
              <li key={t.identity}>
                <button
                  type="button"
                  id={`mention-opt-${i}`}
                  role="option"
                  aria-selected={i === mentionIdx}
                  // onMouseDown (not onClick) so the pick fires before the textarea blurs.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(t)
                  }}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    i === mentionIdx ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-sunken',
                  )}
                >
                  <Avatar name={t.name} size="sm" />
                  <span className="truncate">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
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
          className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]"
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
                className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]"
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
                <IconButton type="button" size="sm" label="Send a GIF" icon={<GifIcon />} active={gifOpen} className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]" />
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
          onChange={(e) => {
            onDraftChange(e.target.value)
            syncMention(e.target)
          }}
          onKeyUp={(e) => syncMention(e.currentTarget)}
          onClick={(e) => syncMention(e.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={onComposerKeyDown}
          rows={1}
          placeholder="Message — @ to mention"
          aria-label="Message"
          role="combobox"
          aria-expanded={showMentions}
          aria-controls="mention-listbox"
          aria-autocomplete="list"
          aria-activedescendant={showMentions ? `mention-opt-${mentionIdx}` : undefined}
          className={cn(
            // Cap relative to viewport on phones so a multi-line draft doesn't
            // crowd out the timeline when the on-screen keyboard is up.
            'max-h-[20dvh] min-h-9 flex-1 resize-none rounded-field bg-sunken px-3 py-2 text-base sm:max-h-28 sm:text-sm',
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

/**
 * The scrolling timeline, memoized. Isolated from ChatPanel's high-frequency
 * re-renders (draft typing, `useParticipants()` speaking-state churn) so the
 * ~200-message list and its per-message `renderRichText` only re-run when chat
 * state actually changes. All callbacks passed in are stable (hook `useCallback`s).
 */
const MessageList = memo(function MessageList({
  items,
  reactions,
  pinned,
  myIdentity,
  onReact,
  onReply,
  onTogglePin,
  onEdit,
}: {
  items: ChatItem[]
  reactions: ReactionMap
  pinned: PinnedMessage[]
  myIdentity: string
  onReact: (id: string, emoji: string) => void
  onReply: (item: ChatItem) => void
  onTogglePin: (item: ChatItem) => void
  onEdit: (id: string, text: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="text-sm font-medium">No messages yet</p>
          <p className="mt-1 text-xs text-ink-muted">Say hi or share a file.</p>
        </div>
      </div>
    )
  }
  const isPinned = (id: string) => pinned.some((p) => p.id === id)
  return (
    <>
      {items.map((item, i) => (
        <MessageRow
          key={item.id}
          item={item}
          grouped={continuesGroup(items[i - 1], item)}
          pinned={isPinned(item.id)}
          reactions={reactions[item.id]}
          myIdentity={myIdentity}
          onReact={(emoji) => onReact(item.id, emoji)}
          onReply={() => onReply(item)}
          onTogglePin={() => onTogglePin(item)}
          onEdit={item.kind === 'text' && item.isLocal ? (text) => onEdit(item.id, text) : undefined}
        />
      ))}
    </>
  )
})

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
  // Highlight the whole row when you were tagged, so a mention is scannable in a
  // busy timeline (Slack/Teams convention).
  const mentionsMe = item.kind === 'text' && mentionsIdentity(item.text, myIdentity)
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
    <div
      className={cn(
        'group relative flex gap-2.5',
        grouped ? 'mt-0.5' : 'mt-3 first:mt-0',
        mentionsMe && '-mx-1.5 rounded-field border-l-2 border-accent bg-accent-soft/40 py-1 pl-2 pr-1.5',
      )}
    >
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

        {/* Quoted message this one replies to — a compact card with an accent rail
            so the threaded context reads at a glance. */}
        {replyTo && (
          <div className="mt-1 flex items-stretch gap-2 overflow-hidden rounded-field bg-sunken/70 pr-2">
            <span aria-hidden className="w-0.5 shrink-0 self-stretch bg-accent/60" />
            <div className="min-w-0 flex-1 py-1">
              <p className="flex items-center gap-1 text-[11px] font-medium text-ink-muted [&_svg]:size-3">
                <ReplyIcon />
                {replyTo.name}
              </p>
              <p className="truncate text-xs text-ink-subtle">{replyTo.text}</p>
            </div>
          </div>
        )}

        {editing && item.kind === 'text' ? (
          <div className="mt-0.5 flex flex-col gap-1.5">
            <textarea
              value={editDraft}
              ref={(el) => {
                // Size to content on open so the whole message is visible.
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
              onChange={(e) => {
                setEditDraft(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
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
              className="max-h-40 min-h-9 w-full resize-none overflow-y-auto rounded-field bg-sunken px-2.5 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="accent" onClick={saveEdit}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {/* Keyboard hint is desktop-only guidance — hidden on touch. */}
              <span className="hidden text-xs text-ink-subtle sm:inline">
                Enter to save · Esc to cancel
              </span>
            </div>
          </div>
        ) : item.kind === 'text' ? (
          looksLikeImageUrl(item.text) ? (
            <ImageBubble src={item.text} />
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{renderRichText(item.text, myIdentity)}</p>
          )
        ) : (
          <FileMessage file={item} />
        )}

        <ReactionChips reactions={reactions} myIdentity={myIdentity} onReact={onReact} />
      </div>

      {/* Hover (desktop) / always-on (touch) message actions. Hidden while
          editing so the toolbar never overlaps the edit field. */}
      <div
        className={cn(
          'absolute right-0 top-0 flex gap-0.5 rounded-control bg-surface p-0.5 opacity-0 shadow-pop transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          editing && 'hidden',
        )}
      >
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
    <div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5" aria-live="polite">
      <span className="flex items-center gap-[3px] rounded-full bg-sunken px-2 py-1.5" aria-hidden>
        {[0, 0.15, 0.3].map((delay) => (
          <span
            key={delay}
            className="mn-typing-dot size-1.5 rounded-full bg-ink-subtle"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span className="truncate text-xs text-ink-muted">{label}</span>
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
  // Local files (blob URLs) and the GIF picker's own hosts auto-load; any other
  // remote URL is click-to-load so a sender can't use it as an IP/tracking pixel.
  const safeToAutoLoad = Boolean(download) || src.startsWith('blob:') || isAutoLoadImageUrl(src)
  const [loaded, setLoaded] = useState(safeToAutoLoad)

  if (!loaded) {
    let host = src
    try {
      host = new URL(src).host
    } catch {
      /* keep raw src */
    }
    return (
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="mt-1 flex max-w-full items-center gap-2 rounded-field border border-line bg-sunken px-3 py-2 text-left text-sm text-ink-muted hover:border-line-strong hover:text-ink"
      >
        <DownloadIcon className="size-4 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium text-ink">Show image</span>
          <span className="block truncate text-xs text-ink-subtle">{host}</span>
        </span>
      </button>
    )
  }

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
