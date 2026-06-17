/**
 * @mention encoding for chat. LiveKit's chat carries only a plain string, so a
 * mention is encoded inline with private-use delimiters (chars users can't type)
 * that wrap the target's identity + display name:
 *
 *   …OPEN identity SEP name CLOSE…
 *
 * The composer keeps the draft human-readable (`@Jane Doe`); mentions are encoded
 * at send time by matching the typed text against the live participant list, and
 * decoded for rendering. This keeps the textarea clean and still lets every client
 * resolve *who* was tagged (so "you were mentioned" works regardless of name).
 */
// Unicode Private Use Area — never produced by a keyboard, safe as delimiters.
const OPEN = ''
const SEP = ''
const CLOSE = ''

/** Matches one encoded mention; group 1 = identity, group 2 = display name. */
export const MENTION_RE = new RegExp(`${OPEN}([^${SEP}${CLOSE}]*)${SEP}([^${CLOSE}]*)${CLOSE}`, 'g')

export interface MentionTarget {
  identity: string
  name: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Encode `@Name` runs that match a known participant into the wire form. Longest
 * names first so "@Jane Doe" wins over "@Jane". The match must end on a boundary
 * (end-of-string, whitespace, or punctuation) so "@Jane" doesn't fire inside
 * "@Janet". Already-encoded text is left untouched.
 */
export function encodeMentions(text: string, targets: MentionTarget[]): string {
  if (!targets.length || !text.includes('@')) return text
  const sorted = [...targets].sort((a, b) => b.name.length - a.name.length)
  let out = text
  for (const t of sorted) {
    if (!t.name) continue
    const re = new RegExp(`@${escapeRegExp(t.name)}(?=$|[\\s.,!?;:'")\\]])`, 'g')
    out = out.replace(re, `${OPEN}${t.identity}${SEP}${t.name}${CLOSE}`)
  }
  return out
}

/** Strip mention encoding back to readable `@Name` for plain-text surfaces
 *  (reply quotes, pinned bar, notifications) that don't run the rich renderer. */
export function plainText(encoded: string): string {
  return encoded.replace(MENTION_RE, (_full, _id, name) => `@${name}`)
}

/** Identities tagged in an encoded message (used for "was I mentioned"). */
export function mentionedIdentities(encoded: string): string[] {
  const ids: string[] = []
  for (const m of encoded.matchAll(MENTION_RE)) ids.push(m[1])
  return ids
}

/** True if `myIdentity` is tagged anywhere in the encoded text. */
export function mentionsIdentity(encoded: string, myIdentity: string): boolean {
  return mentionedIdentities(encoded).includes(myIdentity)
}
