/*
  Anonymous usage counts (docs/analytics-proposal.md, decided Sept 2026).

  Each count is an event name plus at most two values from a FIXED list below —
  never a room name, person, account, device, IP or raw error text. Anything not
  on the list is dropped, so a client can't smuggle free text in. Stored in
  Cloudflare Workers Analytics Engine (binding USAGE); without the binding (local
  dev, the Express server) counting is a no-op.
*/

const SURFACE = ['phone', 'desktop']
const DURATION = ['lt1', '1-5', '5-15', '15-30', '30-60', '60plus']

/** event → the allowed values for its first and second detail. */
export const EVENTS = {
  landing: [SURFACE],
  new_call: [SURFACE],
  prejoin: [['new', 'link'], SURFACE],
  joined: [['cam_on', 'cam_off'], ['low_on', 'low_off']],
  left: [DURATION, SURFACE],
  knock_rejected: [
    [
      'host_denied',
      'timed_out',
      'locked',
      'room_full',
      'link_expired',
      'need_link',
      'need_key',
      'not_in_beta',
      'seat_taken',
      'removed',
      'host_absent',
    ],
  ],
  permission_denied: [['camera', 'mic', 'both'], SURFACE],
  // Only failures without a server reason (those are knock_rejected).
  join_error: [['permission', 'network', 'server', 'other'], SURFACE],
}

/** The event as it may be stored, or null if anything about it is off-list. */
export function usageEvent(event, a = '', b = '') {
  const spec = Object.hasOwn(EVENTS, event) ? EVENTS[event] : null
  if (!spec) return null
  const details = [a, b]
  for (let i = 0; i < 2; i++) {
    const v = details[i] ?? ''
    if (v === '') continue
    if (!spec[i] || !spec[i].includes(v)) return null
  }
  return { event, a: a || '', b: b || '' }
}

/** Count one event. Never throws: counting must not break what it counts. */
export function count(env, event, a, b) {
  const e = usageEvent(event, a, b)
  const ds = env && env.USAGE
  if (!e || !ds || typeof ds.writeDataPoint !== 'function') return false
  try {
    ds.writeDataPoint({ indexes: [e.event], blobs: [e.event, e.a, e.b], doubles: [1] })
    return true
  } catch {
    return false
  }
}
