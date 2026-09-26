/**
 * The display-name rules the server enforces at knock (server/core.mjs), applied
 * as you type so nobody meets them as a join error. A name becomes half of the
 * LiveKit identity (`name#deviceId`), so `#` would make that split ambiguous;
 * control characters and unbounded length end up in room metadata (the waiting
 * room queue), which LiveKit caps. Kept free of LiveKit imports: the landing page
 * and the app store use it, and neither may pull the call bundle in.
 */
export const MAX_NAME_LEN = 64

const DISALLOWED = /[#\u0000-\u001f\u007f]/g

export function cleanDisplayName(raw: string): string {
  return raw.replace(DISALLOWED, '').slice(0, MAX_NAME_LEN)
}
