import { isTouch } from '@/lib/device'
import { ApiError } from '@/lib/orchestrator'

/**
 * Anonymous usage counts (docs/analytics-proposal.md). One small ping to our own
 * Worker per event: an event name and at most two values from the fixed list in
 * server/usage.mjs, which drops anything else. No cookies, no ids, no room names.
 * Production builds only, so local dev and the test suites never send any.
 */
export type UsageEvent =
  | 'landing'
  | 'new_call'
  | 'prejoin'
  | 'joined'
  | 'left'
  | 'permission_denied'
  | 'join_error'

export function surface(): 'phone' | 'desktop' {
  return isTouch() ? 'phone' : 'desktop'
}

export function countUsage(e: UsageEvent, a = '', b = ''): void {
  if (!import.meta.env.PROD) return
  try {
    const body = JSON.stringify({ e, a, b })
    // sendBeacon survives the page closing (the "left" count fires on pagehide).
    if (navigator.sendBeacon?.('/api/count', new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/count', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* counting must never break what it counts */
  }
}

/** Minutes in a call → the stored range (mirrors server/usage.mjs durationRange). */
export function durationRange(ms: number): string {
  const m = ms / 60000
  if (m < 1) return 'lt1'
  if (m < 5) return '1-5'
  if (m < 15) return '5-15'
  if (m < 30) return '15-30'
  if (m < 60) return '30-60'
  return '60plus'
}

/** What kind of failure stopped a join — never the message itself. */
export function joinErrorClass(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'seat_taken') return 'seat_taken'
    if (e.status >= 500) return 'server'
    // No readable answer from our server at all: the request didn't get through.
    return e.fromServer ? 'other' : 'network'
  }
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission'
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'TypeError' || /network|failed to fetch|timeout|timed out|websocket|could not establish/i.test(msg)) {
    return 'network'
  }
  return 'other'
}
