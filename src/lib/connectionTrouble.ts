import { useEffect, useState } from 'react'

/**
 * When the current connection trouble started, shared by the in-call banner and
 * the full "Reconnecting" screen that takes over if LiveKit gives up, so the
 * clock you're watching doesn't restart at 0:00 when the call behind it drops.
 *
 * Set on the first Reconnecting, cleared only by a real Connected. A disconnect
 * in between leaves it standing: that's the case the full screen is for.
 */
let since = 0

export function noteTrouble(now = Date.now()): void {
  if (!since) since = now
}

export function clearTrouble(): void {
  since = 0
}

/** When the trouble started (ms), or 0 when there is none. */
export function troubleSince(): number {
  return since
}

/** "0:12", "1:05", "12:30". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Milliseconds since `from`, ticking once a second (0 while `from` is 0). */
export function useElapsed(from: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!from) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [from])
  return from ? Math.max(0, now - from) : 0
}

/** The browser's own word on whether there's a network at all. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
