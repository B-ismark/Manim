import type { ReactNode } from 'react'

/**
 * Minimal, safe inline-markdown renderer for chat messages. Supports the common
 * shortcuts people expect: **bold**, *italic* / _italic_, ~~strikethrough~~ and
 * `inline code`. Returns React nodes (never raw HTML), so there's no injection
 * surface. Bold/italic/strike recurse so they can nest; code is literal.
 */
const PATTERN = /(\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|`([^`]+?)`|\*([^*\n]+?)\*|_([^_\n]+?)_)/

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
