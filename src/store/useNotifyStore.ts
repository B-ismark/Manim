import { create } from 'zustand'

/**
 * Incoming-call system notifications, opt-in. We no longer auto-prompt on load
 * (browsers penalise non-gesture Notification requests and re-surface them every
 * session). Instead the user flips this in Settings, and the permission prompt
 * fires on *that tap* — a gesture browsers honour and remember.
 */
const KEY = 'manim-notify-calls'

function load(): boolean {
  try {
    // Only "on" if the pref is set AND the browser still grants it — a revoked
    // OS permission silently turns the feature back off.
    return (
      localStorage.getItem(KEY) === '1' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    )
  } catch {
    return false
  }
}

interface NotifyState {
  enabled: boolean
  /** Turn on: request permission on the calling gesture. Resolves to the result. */
  enable: () => Promise<boolean>
  disable: () => void
}

export const useNotifyStore = create<NotifyState>((set) => ({
  enabled: load(),
  enable: async () => {
    if (typeof Notification === 'undefined') return false
    let perm = Notification.permission
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission()
      } catch {
        perm = 'denied'
      }
    }
    const ok = perm === 'granted'
    try {
      localStorage.setItem(KEY, ok ? '1' : '0')
    } catch {
      /* private mode — keep the in-memory value */
    }
    set({ enabled: ok })
    return ok
  },
  disable: () => {
    try {
      localStorage.setItem(KEY, '0')
    } catch {
      /* ignore */
    }
    set({ enabled: false })
  },
}))
