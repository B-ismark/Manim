/**
 * Per-author stroke colour assignment.
 *
 * WHY NOT hueFromName() (Avatar.tsx): that hashes a name straight to a hue, which
 * is fine for avatars — they're separated by position, initials and a name label —
 * but strokes overlap on one canvas with none of that. Hashing to 360 hues gives
 * roughly a 60% chance that two of four participants land close enough to be
 * confusable, and arbitrary hues collapse together under the Deuteranopia and
 * Tritanopia presets, which ship as first-class themes (STYLE.md §6).
 *
 * So colours come from a FIXED palette of perceptually-distinct tokens, assigned
 * by position in a deterministically sorted roster. Distinctness is then
 * guaranteed rather than probabilistic for the first PALETTE_SIZE participants.
 *
 * Colour is never the only signal — the overlay also draws a name label and
 * announces the author (STYLE.md §6: never encode meaning in colour alone).
 *
 * Every client sorts identically, so everyone independently derives the same
 * colour for the same person. The author's index also travels in each packet
 * (wire.ts), so a receiver mid-roster-change still renders the sender's intended
 * colour rather than guessing.
 */

/** Number of distinct stroke colours. Backed by --annotate-1..8 in app.css. */
export const PALETTE_SIZE = 8

/** Stable fallback hash, only used for an identity missing from the roster. */
function hashIdentity(identity: string): number {
  let h = 0
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) % 100003
  return h
}

/**
 * Palette index (0..PALETTE_SIZE-1) for `identity` given the room's identities.
 *
 * The roster is sorted here rather than trusted in the caller's order: LiveKit
 * does not guarantee participant lists arrive in the same order on every client,
 * and an inconsistent order would give the same person different colours on
 * different screens.
 */
export function colorIndexFor(identity: string, identities: readonly string[]): number {
  const pos = [...identities].sort((a, b) => a.localeCompare(b)).indexOf(identity)
  if (pos === -1) return hashIdentity(identity) % PALETTE_SIZE
  return pos % PALETTE_SIZE
}

/**
 * CSS custom property holding the colour for a palette index. Components read
 * this rather than any literal — no hardcoded colour ever ships (STYLE.md §3).
 */
export function colorVar(index: number): string {
  const i = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE
  return `--annotate-${i + 1}`
}
