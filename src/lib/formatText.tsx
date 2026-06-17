import type { ReactNode } from 'react'
import { MENTION_RE, OPEN } from '@/features/chat/mentions'

/**
 * Minimal, safe inline-markdown renderer for chat messages. Supports the common
 * shortcuts people expect: **bold**, *italic* / _italic_, ~~strikethrough~~ and
 * `inline code`. Returns React nodes (never raw HTML), so there's no injection
 * surface. Bold/italic/strike recurse so they can nest; code is literal.
 */
const PATTERN = /(\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|`([^`]+?)`|\*([^*\n]+?)\*|_([^_\n]+?)_)/

/**
 * Render chat text with @mentions highlighted, then markdown on the rest. Mentions
 * are encoded inline (see features/chat/mentions); a mention of `myIdentity` gets
 * the stronger "you" treatment. Splitting on mentions first keeps markdown from
 * ever seeing the private-use delimiter chars.
 */
export function renderRichText(text: string, myIdentity?: string): ReactNode {
  if (!text.includes(OPEN)) return renderMarkdown(text)
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  const re = new RegExp(MENTION_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{renderMarkdown(text.slice(last, m.index))}</span>)
    const [, identity, name] = m
    const isMe = myIdentity !== undefined && identity === myIdentity
    out.push(
      // Self-mention = filled accent pill (white ink, AA-verified). Other mentions
      // = bold accent text (no tinted background) — same contrast as any accent
      // text in the app, which avoids the borderline text-on-accent-soft ratio in
      // dark mode.
      <span
        key={key++}
        className={isMe ? 'rounded bg-accent px-1 font-medium text-accent-ink' : 'font-semibold text-accent'}
      >
        @{name}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<span key={key++}>{renderMarkdown(text.slice(last))}</span>)
  return out
}

export function renderMarkdown(text: string): ReactNode {
  const out: ReactNode[] = []
  let rest = text
  let key = 0
  // Bounded loop: each iteration consumes at least the matched token or the
  // whole remainder, so it always terminates.
  while (rest.length > 0) {
    const m = PATTERN.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    if (m[2] !== undefined) out.push(<strong key={key++}>{renderMarkdown(m[2])}</strong>)
    else if (m[3] !== undefined) out.push(<s key={key++}>{renderMarkdown(m[3])}</s>)
    else if (m[4] !== undefined)
      out.push(
        <code key={key++} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.85em]">
          {m[4]}
        </code>,
      )
    else if (m[5] !== undefined) out.push(<em key={key++}>{renderMarkdown(m[5])}</em>)
    else if (m[6] !== undefined) out.push(<em key={key++}>{renderMarkdown(m[6])}</em>)
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}
