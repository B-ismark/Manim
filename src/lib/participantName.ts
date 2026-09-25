/**
 * The name to show for a participant: their LiveKit `name` when they sent one,
 * else the `name` half of their `name#deviceId` identity, else `fallback`.
 *
 * Pure and import-free so the chat, reactions, annotation and announcer paths
 * can all share it without pulling LiveKit in. Callers pick the fallback — most
 * say "Guest", spoken/toast copy says "Someone", and a tile label passes `''`.
 */
export function displayNameOf(identity: string, name?: string, fallback = 'Guest'): string {
  return name || identity.split('#')[0] || fallback
}
