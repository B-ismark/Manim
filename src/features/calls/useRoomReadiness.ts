import { useEffect, useState } from 'react'
import { roomStatus, type RoomStatus } from '@/lib/orchestrator'
import { roomDeviceId } from '@/lib/roomDevice'

/** How often the join screen re-asks while you get ready. */
const POLL_MS = 10_000

/**
 * Who's in the call while you're on the join screen, so nobody walks into an
 * empty room (or a locked one) without knowing. Polls while the page is visible,
 * asks again the moment it comes back, and settles on `unknown` when it can't
 * tell, which the screen shows as a plain "Joining".
 *
 * Your name and device go along only so the server can leave YOUR seat out of
 * the count (a tab still open elsewhere isn't someone waiting for you).
 */
export function useRoomReadiness(room: string, secret: string | undefined, name: string, deviceId: string): RoomStatus {
  const [status, setStatus] = useState<RoomStatus>({ state: 'unknown' })
  const trimmed = name.trim()
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    // One ask at a time: a tab coming back mid-ask must not start a second loop.
    let asking = false
    const ask = async () => {
      window.clearTimeout(timer)
      if (asking) return
      asking = true
      try {
        if (document.visibilityState === 'visible') {
          const device = await roomDeviceId(deviceId, room)
          const next = await roomStatus({ room, secret, name: trimmed || undefined, deviceId: device })
          if (!alive) return
          setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        }
      } finally {
        asking = false
      }
      if (alive) {
        window.clearTimeout(timer)
        timer = window.setTimeout(ask, POLL_MS)
      }
    }
    // A short beat before the first ask, so typing a name doesn't fire one per key.
    timer = window.setTimeout(ask, 400)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [room, secret, trimmed, deviceId])
  return status
}

/** The join screen's one line about the room, or null for plain "Joining". */
export function readinessLine(s: RoomStatus): { text: string; tone: 'live' | 'quiet' | 'warn' } | null {
  if (s.state === 'unknown') return null
  if (s.state === 'empty') return { text: 'No one else is here yet', tone: 'quiet' }
  // Short enough for one line at 320px: the whole point is reading it at a glance.
  const people = s.count === 1 ? '1 person in the call' : `${s.count} people in the call`
  const short = `${s.count} in the call`
  if (!s.youAreHost) {
    if (s.locked) return { text: `${short} · Locked by the host`, tone: 'warn' }
    if (s.full) return { text: 'This call is full', tone: 'warn' }
    if (!s.hostHere) return { text: `${short} · ${s.waiting ? 'Waiting for the host' : 'Host isn’t here yet'}`, tone: 'live' }
    if (s.waiting) return { text: `${short} · Host will let you in`, tone: 'live' }
  }
  return { text: people, tone: 'live' }
}
