import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Avatar, Button, IconButton, Popover, Sheet, Tooltip } from '@/components/primitives'
import { AttachIcon, CloseIcon, DownloadIcon, GifIcon, PeopleIcon, PinIcon, ReactionIcon, ReplyIcon, SendIcon } from '@/components/icons'
import { EmojiPicker } from '@/islands/EmojiPicker'
import { encodeMentions, mentionsIdentity, plainText, type MentionTarget } from '@/features/chat/mentions'
import { joinNames, reactorList } from '@/features/chat/reactors'
import type { ReactionMap, ReactorNames } from '@/features/chat/useChatMessages'
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
  // Never group across the verified/replayed boundary — a peer-replayed (unverified)
  // message must not hide under a live, verified-author header.
  const prevReplayed = prev.kind === 'text' && prev.replayed
  const itemReplayed = item.kind === 'text' && item.replayed
  if (prevReplayed !== itemReplayed) return false
  return (
    prev.fromIdentity === item.fromIdentity &&
    prev.isLocal === item.isLocal &&
    item.timestamp - prev.timestamp < GROUP_WINDOW_MS
  )
}

/** Chat timeline + composer. Images preview inline; files + GIFs supported (STYLE.md §5 Tier-1). */
export function ChatPanel({ chat }: { chat: ChatApi }) {
  const { items, sendText, sendFile, pinned, togglePin, unpin, reactions, reactorNames, toggleReaction, myIdentity, typingNames, notifyTyping, stopTyping, editMessage } = chat
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null)
  const narrow = useIsTouch()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Scroll-position tracking that drives the jump-to-latest control: whether the
  // reader is pinned to the bottom, and how many messages arrived while they
  // weren't. `atBottomRef` mirrors the state for use inside the new-message effect
  // without making it a dependency.
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const [unseen, setUnseen] = useState(0)
  const prevLen = useRef(0)

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

  // New-message behaviour: pin to the latest when the reader is already at the
  // bottom, or when the message is mine (I just sent it). Otherwise leave them
  // where they are and stack the arrivals into the unseen counter.
  useEffect(() => {
    const grew = items.length - prevLen.current
    prevLen.current = items.length
    if (grew <= 0) return
    const last = items[items.length - 1]
    if (atBottomRef.current || last?.isLocal) {
      endRef.current?.scrollIntoView({ block: 'end' })
      setUnseen(0)
    } else {
      setUnseen((u) => u + grew)
    }
  }, [items.length, items])

  // Keep the latest message + composer above the on-screen keyboard on mobile.
  // scrollIntoView-on-send doesn't fire when the keyboard *opens* (a visualViewport
  // resize, not a send), so on iOS Safari the keyboard could cover the last message
  // or the input. Only re-pin while the composer is focused — otherwise opening the
  // keyboard would yank someone out of scrolled-up history.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (document.activeElement === inputRef.current) {
        endRef.current?.scrollIntoView({ block: 'end' })
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Grow the composer to fit the draft (up to the CSS max-height, after which it
  // scrolls). A rows=1 textarea otherwise stays one line tall and the rest
  // scrolls hidden inside it.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  async function submit() {
    const original = draft
    if (!original.trim()) return
    // Encode @mentions against the current roster just before sending so each
    // client can resolve who was tagged regardless of name changes.
    const body = encodeMentions(original, mentionTargets)
    const reply = replyTo ?? undefined
    // Optimistic clear so the composer feels instant…
    setDraft('')
    setMention(null)
    stopTyping()
    const ok = await sendText(body, reply)
    if (ok) {
      setReplyTo(null)
    } else {
      // …but if the transport rejected it (e.g. mid-reconnect), put the message
      // back (the original, not the encoded form) and say so — don't lose it.
      setDraft(original)
      setError("Couldn't send — check your connection and try again.")
    }
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
    setReplyTo({ id: item.id, name: item.isLocal ? 'You' : item.fromName, text: previewOf(item) })
    inputRef.current?.focus()
  }, [])

  // Tap a reply's quote → scroll the original into view and flash it. Imperative
  // (querySelector + classList) so the ~200-row memoized list isn't re-rendered
  // just to highlight one row. No-op if the original has scrolled out of history.
  const listRef = useRef<HTMLDivElement>(null)
  const jumpToMessage = useCallback((id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    el.classList.remove('mn-flash')
    void el.offsetWidth // restart the animation if it's already mid-flash
    el.classList.add('mn-flash')
  }, [])

  // Track how close the reader is to the latest message. ~80px of slack counts as
  // "at the bottom" so a tiny manual nudge doesn't flip the control on.
  const onListScroll = () => {
    const el = listRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = bottom
    setAtBottom(bottom)
    if (bottom) setUnseen(0)
  }

  const scrollToBottom = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' })
    atBottomRef.current = true
    setAtBottom(true)
    setUnseen(0)
  }

  // Insert an emoji at the caret (composer emoji picker — distinct from reacting to
  // a message). Keeps focus + caret after the inserted glyph so typing continues.
  function insertEmoji(emoji: string) {
    const el = inputRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? start
    const next = draft.slice(0, start) + emoji + draft.slice(end)
    onDraftChange(next)
    const pos = start + emoji.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
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
      <p className="shrink-0 border-b border-line px-3 py-1.5 text-center text-[11px] text-ink-subtle">
        Messages are visible only to people in this call.
      </p>

      {pinned.length > 0 && (
        <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2">
          {pinned.map((p) => (
            <PinnedRow key={p.id} pin={p} onJump={() => jumpToMessage(p.id)} onUnpin={() => unpin(p.id)} />
          ))}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <MessageList
            items={items}
            reactions={reactions}
            reactorNames={reactorNames}
            pinned={pinned}
            myIdentity={myIdentity}
            onReact={toggleReaction}
            onReply={startReply}
            onTogglePin={togglePin}
            onEdit={editMessage}
            onJumpTo={jumpToMessage}
          />
          <div ref={endRef} />
        </div>

        {/* Jump-to-latest: shown once the reader scrolls up off the bottom. Carries
            an unseen-message count so they know whether catching up is worth it. */}
        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={
              unseen > 0
                ? `Scroll to latest — ${unseen} new ${unseen === 1 ? 'message' : 'messages'}`
                : 'Scroll to latest messages'
            }
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-raised py-1.5 pl-2.5 pr-3 text-xs font-medium text-ink shadow-pop transition-colors hover:bg-sunken [&_svg]:size-4"
          >
            {unseen > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent-ink tabular-nums">
                {unseen > 99 ? '99+' : unseen}
              </span>
            )}
            <span>{unseen > 0 ? 'new' : 'Latest'}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-1 flex items-center justify-between gap-2 rounded-field bg-sunken px-3 py-2 text-xs text-danger-text">
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
        className="relative flex shrink-0 flex-col gap-1.5 border-t border-line p-3"
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
            className="absolute inset-x-3 bottom-full z-10 mb-2 max-h-48 overflow-y-auto rounded-field border border-line bg-surface py-1 shadow-pop no-scrollbar"
          >
            {suggestions.map((t, i) => (
              <li key={t.identity}>
                <button
                  type="button"
                  id={`mention-opt-${i}`}
                  role="option"
                  aria-selected={i === mentionIdx}
                  // onPointerDown (not onClick) so the pick fires before the textarea
                  // blurs — and pointer covers touch too, where a click would land
                  // after blur dismissed the list (and behind the on-screen keyboard).
                  onPointerDown={(e) => {
                    e.preventDefault()
                    pickMention(t)
                  }}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    i === mentionIdx ? 'bg-accent-soft text-accent-text' : 'text-ink hover:bg-sunken',
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
            'max-h-[20dvh] min-h-9 w-full resize-none rounded-field bg-sunken px-3 py-2 text-base sm:max-h-28 sm:text-sm',
            'placeholder:text-ink-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        />
        {/* Toolbar under a full-width input (Teams/Slack): options on the left, send
            on the right. Keeps every composer option while giving the textarea the
            whole width to type in. */}
        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            size="sm"
            label="Attach a file"
            icon={<AttachIcon />}
            className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]"
            onClick={() => fileInputRef.current?.click()}
          />
          {/* Emoji insert (distinct from reacting to a message): popover on desktop,
              bottom sheet on touch — same pattern as the GIF picker. */}
          {narrow ? (
            <>
              <IconButton
                type="button"
                size="sm"
                label="Add emoji"
                icon={<ReactionIcon />}
                active={emojiOpen}
                className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]"
                onClick={() => setEmojiOpen(true)}
              />
              <Sheet open={emojiOpen} onOpenChange={setEmojiOpen} side="bottom" title="Add emoji">
                <EmojiPicker
                  onSelect={(e) => {
                    insertEmoji(e)
                    setEmojiOpen(false)
                  }}
                />
              </Sheet>
            </>
          ) : (
            <Popover
              open={emojiOpen}
              onOpenChange={setEmojiOpen}
              side="top"
              align="start"
              trigger={
                <IconButton type="button" size="sm" label="Add emoji" icon={<ReactionIcon />} active={emojiOpen} className="bg-transparent text-ink hover:bg-sunken [&_svg]:size-[18px]" />
              }
            >
              <div className="w-[22rem]">
                <EmojiPicker
                  onSelect={(e) => {
                    insertEmoji(e)
                    setEmojiOpen(false)
                  }}
                />
              </div>
            </Popover>
          )}
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
          <span className="flex-1" aria-hidden />
          <IconButton
            type="submit"
            size="sm"
            tone="accent"
            label="Send message"
            icon={<SendIcon />}
            disabled={!draft.trim()}
          />
        </div>
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
  reactorNames,
  pinned,
  myIdentity,
  onReact,
  onReply,
  onTogglePin,
  onEdit,
  onJumpTo,
}: {
  items: ChatItem[]
  reactions: ReactionMap
  reactorNames: ReactorNames
  pinned: PinnedMessage[]
  myIdentity: string
  onReact: (id: string, emoji: string) => void
  onReply: (item: ChatItem) => void
  onTogglePin: (item: ChatItem) => void
  onEdit: (id: string, text: string) => void
  onJumpTo: (id: string) => void
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
          sameMinuteAsPrev={
            !!items[i - 1] && timeOf(items[i - 1].timestamp) === timeOf(item.timestamp)
          }
          pinned={isPinned(item.id)}
          reactions={reactions[item.id]}
          reactorNames={reactorNames}
          myIdentity={myIdentity}
          onReact={(emoji) => onReact(item.id, emoji)}
          onReply={() => onReply(item)}
          onTogglePin={() => onTogglePin(item)}
          onEdit={item.kind === 'text' && item.isLocal ? (text) => onEdit(item.id, text) : undefined}
          onJumpTo={onJumpTo}
        />
      ))}
    </>
  )
})

function MessageRow({
  item,
  grouped,
  sameMinuteAsPrev,
  pinned,
  reactions,
  reactorNames,
  myIdentity,
  onReact,
  onReply,
  onTogglePin,
  onEdit,
  onJumpTo,
}: {
  item: ChatItem
  /** True when this continues the previous sender's run — avatar/header collapse. */
  grouped: boolean
  /** The previous row already printed this exact clock time. */
  sameMinuteAsPrev: boolean
  pinned: boolean
  /** This message's reactions: emoji → identities who reacted. */
  reactions?: ReactionMap[string]
  /** Identity → display name for reactors, so a pill can say WHO. */
  reactorNames: ReactorNames
  myIdentity: string
  onReact: (emoji: string) => void
  onReply: () => void
  onTogglePin: () => void
  /** Defined only for your own text messages — edits the body in place. */
  onEdit?: (text: string) => void
  /** Scroll to + flash the message a reply quotes. */
  onJumpTo: (id: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const narrow = useIsTouch()
  // Touch action model: tap a bubble to open the actions popover (Reply, reaction,
  // edit, pin); swipe-left is a shortcut for reply. Desktop keeps the hover toolbar.
  const [actionsOpen, setActionsOpen] = useState(false)
  // Touch reaction picker rides a bottom Sheet (full width + scrollable + scrim)
  // rather than the cramped long-press popover — the emoji grid needs the room.
  const [reactOpen, setReactOpen] = useState(false)
  // "Who reacted" — the touch counterpart to the desktop chip tooltip.
  const [whoOpen, setWhoOpen] = useState(false)
  const hasReactions = Object.values(reactions ?? {}).some((by) => by.length > 0)
  const [swipeX, setSwipeX] = useState(0)
  const press = useRef<{ x: number; y: number; moved: boolean; swiping: boolean }>({
    x: 0,
    y: 0,
    moved: false,
    swiping: false,
  })
  const SWIPE_TRIGGER = 48 // px left-drag past which release fires reply
  const SWIPE_MAX = 72

  const onRowPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!narrow || editing) return
    press.current = { x: e.clientX, y: e.clientY, moved: false, swiping: false }
  }
  const onRowPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!narrow || editing) return
    const dx = e.clientX - press.current.x
    const dy = e.clientY - press.current.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      press.current.moved = true
    }
    // Horizontal-dominant left drag = reply swipe; vertical stays a scroll.
    if (dx < -6 && Math.abs(dx) > Math.abs(dy)) {
      press.current.swiping = true
      setSwipeX(Math.max(dx, -SWIPE_MAX))
    }
  }
  const settleSwipe = () => {
    if (press.current.swiping && swipeX <= -SWIPE_TRIGGER) onReply()
    press.current.swiping = false
    setSwipeX(0)
  }
  const onRowPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!narrow) return
    const wasSwiping = press.current.swiping
    settleSwipe()
    // A clean tap (no drag, no swipe) on the bubble body opens the actions menu.
    // Skip taps that land on interactive children (links, reaction chips, the
    // reply-quote button, the file download) so those keep their own behaviour.
    if (wasSwiping || press.current.moved || editing) return
    if ((e.target as HTMLElement).closest('a, button, textarea, input, [role="button"]')) return
    setActionsOpen(true)
    navigator.vibrate?.(10)
  }
  const onRowPointerLeave = () => {
    if (!narrow) return
    settleSwipe()
  }

  const replyTo = item.kind === 'text' ? item.replyTo : undefined
  // Highlight the whole row when you were tagged, so a mention is scannable in a
  // busy timeline (Slack/Teams convention).
  const mentionsMe = item.kind === 'text' && mentionsIdentity(item.text, myIdentity)
  const react = (emoji: string) => {
    onReact(emoji)
    setPickerOpen(false)
    setReactOpen(false)
    setActionsOpen(false)
  }
  // Highlight the row whose action menu / reaction sheet / editor is open, so it's
  // unambiguous which message a tapped action applies to.
  const actionsActive = actionsOpen || reactOpen
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
      data-mid={item.id}
      onPointerDown={onRowPointerDown}
      onPointerMove={onRowPointerMove}
      onPointerUp={onRowPointerUp}
      onPointerLeave={onRowPointerLeave}
      onContextMenu={narrow ? (e) => e.preventDefault() : undefined}
      className={cn(
        'group relative flex gap-2.5 rounded-field transition-colors',
        grouped ? 'mt-0.5' : 'mt-3 first:mt-0',
        mentionsMe && '-mx-1.5 border-l-2 border-accent bg-accent-soft/40 py-1 pl-2 pr-1.5',
        // Active-action highlight wins over the mention tint so the target is clear.
        actionsActive && '-mx-1.5 bg-sunken px-1.5 py-1 ring-2 ring-accent',
      )}
    >
      {/* Reply affordance revealed as you swipe the bubble left (touch). */}
      {narrow && swipeX < 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-accent [&_svg]:size-5"
          style={{ opacity: Math.min(1, Math.abs(swipeX) / 56) }}
        >
          <ReplyIcon />
        </span>
      )}
      {grouped ? (
        // Keep the bubble aligned with the grouped run (matches Avatar sm = size-8).
        <div className="w-8 shrink-0" aria-hidden />
      ) : (
        <Avatar name={item.fromName} size="sm" />
      )}
      <div
        className="min-w-0 flex-1"
        style={
          narrow
            ? { transform: `translateX(${swipeX}px)`, transition: press.current.swiping ? 'none' : 'transform .15s ease-out' }
            : undefined
        }
      >
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{item.isLocal ? 'You' : item.fromName}</span>
            {/* Only when it has actually changed. Four groups inside one minute
                printed "09:52 PM" four times, which is four chances to read a
                number that carries no new information. */}
            {!sameMinuteAsPrev && (
              <span className="text-xs text-ink-subtle">{timeOf(item.timestamp)}</span>
            )}
            {item.kind === 'text' && item.edited && (
              <span className="text-[11px] text-ink-subtle">(edited)</span>
            )}
            {/* Peer-replayed history: sender isn't verified (P2P sync, no server).
                Flag it so a fabricated message can't pass as a verified author. */}
            {item.kind === 'text' && item.replayed && (
              <span
                className="text-[11px] text-ink-subtle italic"
                title="Sent before you joined — sender not verified"
              >
                · before you joined
              </span>
            )}
            {pinned && <PinIcon className="size-3 text-accent" aria-label="Pinned" />}
          </div>
        )}

        {/* Quoted message this one replies to — a compact card with an accent rail
            so the threaded context reads at a glance. When the original is linkable
            (its id rode along in the reply), the card is a button that scrolls back
            to it; otherwise it stays a static quote. */}
        {replyTo &&
          (() => {
            const rail = <span aria-hidden className="w-0.5 shrink-0 self-stretch bg-accent/60" />
            const body = (
              <div className="min-w-0 flex-1 py-1 text-left">
                <p className="flex items-center gap-1 text-[11px] font-medium text-ink-muted [&_svg]:size-3">
                  <ReplyIcon />
                  {replyTo.name}
                </p>
                <p className="truncate text-xs text-ink-subtle">{replyTo.text}</p>
              </div>
            )
            const cls = 'mt-1 flex w-full items-stretch gap-2 overflow-hidden rounded-field bg-sunken/70 pr-2'
            return replyTo.id ? (
              <button
                type="button"
                onClick={() => onJumpTo(replyTo.id!)}
                className={cn(cls, 'transition-colors hover:bg-sunken')}
                aria-label={`Go to the message from ${replyTo.name} that this replies to`}
              >
                {rail}
                {body}
              </button>
            ) : (
              <div className={cls}>
                {rail}
                {body}
              </div>
            )
          })()}

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

        <ReactionChips
          reactions={reactions}
          reactorNames={reactorNames}
          myIdentity={myIdentity}
          onReact={onReact}
        />
      </div>

      {/* DESKTOP: hover/focus-revealed toolbar. Hidden on touch (which uses
          swipe-to-reply + the long-press popover) and while editing. */}
      {!narrow && (
        <div
          className={cn(
            'absolute right-0 flex gap-0.5 rounded-control bg-surface p-0.5 opacity-0 shadow-pop transition-opacity focus-within:opacity-100 group-hover:opacity-100',
            // WHERE this sits decides whether you can read the message you are
            // about to act on. Measured at the panel's real width: the bar is
            // 116px wide (154px on your own messages, which add Edit).
            //
            // On an ungrouped row `top-0` lines up with the name+time header,
            // which is short — 139-245px of clearance — so the bar has room and
            // the text below is untouched. A GROUPED row has no header, so the
            // same `top-0` lands squarely on the first line of the message: a
            // line with 83px of clearance lost its last word the moment you
            // reached for the reaction button.
            //
            // Grouped rows therefore float the bar just above themselves. It
            // still overlaps something — in a 400px panel there is no free
            // column to retreat to, and reserving 116px permanently would cost
            // a third of the text width — but what it overlaps is the previous
            // line of the SAME author's run, which is context you have already
            // read, rather than the message you are pointing at.
            // Flush, no gap: any space between the bar and its row is a strip of
            // the PREVIOUS row, and the pointer crossing it on the way to a
            // button would leave the group and take the bar with it.
            grouped ? 'bottom-full z-10' : 'top-0',
            editing && 'hidden',
          )}
        >
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            side="top"
            align="end"
            trigger={<IconButton size="sm" tone="neutral" label="Add reaction" icon={<ReactionIcon />} active={pickerOpen} />}
          >
            <EmojiPicker onSelect={react} />
          </Popover>
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
      )}

      {/* TOUCH: tapping the bubble opens an anchored popover for the actions
          (Reply, react, edit, pin). Reply is also reachable via swipe-left.
          It's MODAL so a swipe inside it can't reach the rows behind it, and Radix
          collision-detection flips/shifts it so it never clips at the panel edge.
          The trigger is a zero-size anchor pinned to the bubble; the tap toggles
          `actionsOpen`. "Add reaction" hands off to a full bottom Sheet — the emoji
          grid needs more room than this little menu has. */}
      {narrow && (
        <>
          <Popover
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            modal
            side="top"
            align="end"
            trigger={<span aria-hidden className="absolute right-2 top-2 h-px w-px" />}
          >
            <div className="flex flex-col">
              <button
                type="button"
                className="flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-[15px] hover:bg-sunken active:bg-sunken [&_svg]:size-[18px] [&_svg]:text-ink-muted"
                onClick={() => {
                  setActionsOpen(false)
                  onReply()
                }}
              >
                <ReplyIcon />
                Reply
              </button>
              <button
                type="button"
                className="flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-[15px] hover:bg-sunken active:bg-sunken [&_svg]:size-[18px] [&_svg]:text-ink-muted"
                onClick={() => {
                  setActionsOpen(false)
                  setReactOpen(true)
                }}
              >
                <ReactionIcon />
                Add reaction
              </button>
              {/* Only once there is something to show. A touch tap on a pill spends
                  itself toggling your own reaction (and there is no hover to carry a
                  tooltip), so this menu is the phone's only route to WHO reacted. */}
              {hasReactions && (
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-[15px] hover:bg-sunken active:bg-sunken [&_svg]:size-[18px] [&_svg]:text-ink-muted"
                  onClick={() => {
                    setActionsOpen(false)
                    setWhoOpen(true)
                  }}
                >
                  <PeopleIcon />
                  Who reacted
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-[15px] hover:bg-sunken active:bg-sunken [&_svg]:size-[18px] [&_svg]:text-ink-muted"
                  onClick={() => {
                    setActionsOpen(false)
                    startEdit()
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  Edit message
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-[15px] hover:bg-sunken active:bg-sunken [&_svg]:size-[18px] [&_svg]:text-ink-muted"
                onClick={() => {
                  setActionsOpen(false)
                  onTogglePin()
                }}
              >
                <PinIcon />
                {pinned ? 'Unpin' : 'Pin'}
              </button>
            </div>
          </Popover>
          <Sheet open={reactOpen} onOpenChange={setReactOpen} side="bottom" title="Add reaction">
            <EmojiPicker onSelect={react} />
          </Sheet>
          <Sheet open={whoOpen} onOpenChange={setWhoOpen} side="bottom" title="Reactions">
            <ReactorBreakdown
              reactions={reactions}
              reactorNames={reactorNames}
              myIdentity={myIdentity}
            />
          </Sheet>
        </>
      )}
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
 *  reactions are highlighted, and tapping a pill toggles yours (Slack/Discord).
 *
 *  WHO reacted is carried three ways, because no single one covers every user:
 *  the `aria-label` names them (screen readers, both pointer types), a hover/focus
 *  tooltip names them on a mouse, and touch — which has no hover and whose tap is
 *  already spent on toggling — gets "Who reacted" in the message's action menu.
 *  A tooltip alone was the version that left every phone unable to find out. */
function ReactionChips({
  reactions,
  reactorNames,
  myIdentity,
  onReact,
}: {
  reactions?: ReactionMap[string]
  reactorNames: ReactorNames
  myIdentity: string
  onReact: (emoji: string) => void
}) {
  const narrow = useIsTouch()
  const entries = reactions ? Object.entries(reactions).filter(([, by]) => by.length > 0) : []
  if (entries.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.map(([emoji, by]) => {
        const mine = by.includes(myIdentity)
        const who = joinNames(reactorList(by, reactorNames, myIdentity))
        const chip = (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-pressed={mine}
            aria-label={`${emoji} ${by.length} — reacted by ${who}`}
            className={cn(
              'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none transition-colors',
              mine
                ? 'border-accent bg-accent-soft text-accent-text'
                : 'border-line bg-sunken text-ink-muted hover:border-line-strong',
            )}
          >
            <span className="text-sm">{emoji}</span>
            <span className="tabular-nums">{by.length}</span>
          </button>
        )
        // No tooltip on touch: it opens on the same tap that toggles the reaction,
        // so it would flash on every press and say nothing you asked for.
        return narrow ? (
          chip
        ) : (
          <Tooltip key={emoji} content={`${who} reacted with ${emoji}`}>
            {chip}
          </Tooltip>
        )
      })}
    </div>
  )
}

/** The full "who reacted" breakdown, grouped by emoji — the touch route to the
 *  same information the desktop tooltip gives. Rendered inside a bottom Sheet. */
function ReactorBreakdown({
  reactions,
  reactorNames,
  myIdentity,
}: {
  reactions?: ReactionMap[string]
  reactorNames: ReactorNames
  myIdentity: string
}) {
  const entries = reactions ? Object.entries(reactions).filter(([, by]) => by.length > 0) : []
  if (entries.length === 0) {
    return <p className="px-1 py-2 text-sm text-ink-muted">No reactions yet.</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {entries.map(([emoji, by]) => (
        <li key={emoji}>
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="text-lg leading-none">{emoji}</span>
            <span className="tabular-nums text-ink-muted">{by.length}</span>
          </p>
          {/* Keyed by index, not by name: two guests can carry the same display
              name, and a duplicate React key would drop one of them from the list
              that exists to account for everybody. */}
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {reactorList(by, reactorNames, myIdentity).map((name, i) => (
              <li key={`${emoji}-${i}`} className="flex items-center gap-2">
                <Avatar name={name} size="sm" />
                <span className="truncate text-sm text-ink">{name}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/** A row in the pinned bar at the top of chat. Mirrors the reply-quote card
 *  (accent rail + label + preview) so it reads as part of the app, and the body
 *  is a button that jumps to the original message — same affordance as tapping a
 *  reply's quote. */
function PinnedRow({ pin, onJump, onUnpin }: { pin: PinnedMessage; onJump: () => void; onUnpin: () => void }) {
  return (
    <div className="flex items-stretch gap-1 overflow-hidden rounded-field border border-line bg-raised">
      <button
        type="button"
        onClick={onJump}
        aria-label={`Go to the pinned message from ${pin.name}`}
        className="flex min-w-0 flex-1 items-stretch gap-2 py-1.5 pl-2 text-left transition-colors hover:bg-sunken"
      >
        <span aria-hidden className="w-0.5 shrink-0 self-stretch rounded-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-medium text-accent [&_svg]:size-3">
            <PinIcon />
            Pinned · {pin.name}
          </p>
          <p className="truncate text-xs text-ink">{pin.text}</p>
        </div>
      </button>
      <IconButton size="sm" tone="neutral" label="Unpin message" icon={<CloseIcon />} onClick={onUnpin} className="self-center" />
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
      <div className="grid size-9 shrink-0 place-items-center rounded-field bg-accent-soft text-accent-text">
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
