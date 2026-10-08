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
// The LiveKit edge's continent — the SERVER's region, never where the person is.
const EDGE = ['af', 'eu', 'na', 'sa', 'as', 'oc', 'other']

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
  // "How was the call?" on the end page: one tap, then (for a bad one) at most one
  // more from a fixed list. Not tied to the call, the person or anything they said.
  rating: [['good', 'bad'], SURFACE],
  rating_issue: [['audio', 'video', 'connection', 'other'], SURFACE],
  // How smoothly a call ran, one summary per person per call (src/lib/callQuality):
  // is lag the network (distance, loss) or the device (cpu)? Ranges only.
  call_rtt: [['lt100', '100-200', '200-300', '300plus'], EDGE],
  call_loss: [['lt1', '1-3', '3-10', '10plus'], EDGE],
  call_fps: [['lt10', '10-20', '20plus'], SURFACE],
  call_limit: [['none', 'cpu', 'bandwidth', 'other'], SURFACE],
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
