import type { ReactorNames } from '@/features/chat/useChatMessages'

/**
 * Turning a reaction's identity list into "who reacted".
 *
 * Pure, and in its own file, because the wording is the whole feature: a chip that
 * says "3" answers nothing, and the label is what the tooltip, the `aria-label` and
 * the touch breakdown sheet all render from. Same split as `lib/tileGrid` — the
 * logic is testable without mounting chat.
 */

/**
 * Names shown before the list collapses into a count.
 *
 * Five is what fits a tooltip beside a 320px-wide panel without becoming a column
 * of text taller than the message it describes. The rest are counted, never
 * dropped — "and 12 more" is still an answer.
 */
export const MAX_NAMED = 5

/**
 * Display names for everyone who reacted, yours first as "You".
 *
 * `by` holds IDENTITIES (what the wire carries and what the toggle keys off).
 * `names` resolves the ones we've heard a name for; anything else falls back to
 * the identity's own `name#device` prefix, which is what a reactor from before
 * this session — or a client too old to send a name — leaves us with.
 *
 * Yours reads "You" and sorts first (Teams/Slack), so you can tell at a glance
 * whether a pill is already yours without decoding a colour. The rest sort by
 * name so the same set of people always reads in the same order, rather than in
 * whatever order the packets happened to arrive.
 */
export function reactorList(by: string[], names: ReactorNames, myIdentity: string): string[] {
  const mine = by.includes(myIdentity)
  const others = by
    .filter((id) => id !== myIdentity)
    .map((id) => names[id] || id.split('#')[0] || 'Guest')
    .sort((a, b) => a.localeCompare(b))
  return mine ? ['You', ...others] : others
}

/**
 * "You, Ama and Kojo" — a spoken list, truncated past MAX_NAMED.
 *
 * The overflow replaces the last name rather than trailing after it: "A, B, C, D,
 * E and 3 more", not "…D and E and 3 more", which is how a naive join reads and
 * which nobody says out loud.
 */
export function joinNames(list: string[]): string {
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  if (list.length <= MAX_NAMED) {
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  }
  return `${list.slice(0, MAX_NAMED).join(', ')} and ${list.length - MAX_NAMED} more`
}
