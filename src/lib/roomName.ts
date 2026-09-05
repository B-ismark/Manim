/**
 * Room identity has two faces:
 *  - the **slug** (`world-cup`) — lowercase, hyphenated, URL/LiveKit-safe. This
 *    is what we route on and what LiveKit keys the room by. Never change it.
 *  - the **display title** (`World Cup`) — what a human typed/expects to read.
 *
 * `go()` in Landing slugifies whatever the user types, so by the time we render
 * it back (PreJoin header, joining screen, other-device list) it's already the
 * hyphenated lowercase form. `prettyRoom` reverses that for *display only*:
 * hyphens/underscores → spaces, Title Case. So "world-cup" reads "World Cup".
 *
 * Numeric segments (random codes like `calm-otter-417`) are left as-is, so a
 * generated code still reads "Calm Otter 417" rather than getting mangled.
 */
/**
 * The forward direction: a hand-TYPED room name → its slug. Lowercase,
 * whitespace→dash, and strip anything that would corrupt the path segment or
 * the `#fragment` where invite secrets ride (`/ ? # % &` and friends) — see
 * lib/roomKeys.ts for why the fragment is fragile.
 *
 * Letters and digits are kept in ANY script (`\p{L}\p{N}`, not `[a-z0-9]`): an
 * ASCII-only class silently erases a name like `会议` to the empty string, which
 * makes non-Latin rooms impossible to create or rejoin. `roomTo` percent-encodes
 * the slug, so a Unicode segment is URL-safe. `_` survives because it needs no
 * encoding and `prettyRoom` below already treats it as a separator.
 *
 * Two Unicode details the obvious version gets wrong, both of which split one
 * typed name across two rooms:
 *
 *  - Combining marks are `\p{M}`, NOT `\p{L}`, so a letter-only class shreds any
 *    script whose vowels are marks — `हिन्दी` comes out as `हनद`. They are kept.
 *  - The SAME name can arrive composed or decomposed (`é` as one code point, or
 *    `e` + U+0301 — macOS and several IMEs hand over the latter). Without NFC the
 *    decomposed form loses its accent and slugs to a different room than the
 *    composed one. Normalising first makes the two agree.
 *
 * Only ever apply this to a typed name. A pasted invite link is the AUTHORITY on
 * which room it points at — re-slugging one rewrites the destination.
 */
export function toSlug(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function prettyRoom(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}
