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
export function prettyRoom(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}
