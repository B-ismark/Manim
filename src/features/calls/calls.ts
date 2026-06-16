import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useCallStore, type IncomingCall } from '@/store/useCallStore'

export type { IncomingCall }

/**
 * Ring a Manim user by email — resolves their id via the `profiles` table and
 * broadcasts an incoming call to their personal Realtime channel. Returns an
 * error string, or null on success. Requires Supabase + a profiles table.
 */
export async function ringUser(
  email: string,
  room: string,
  fromName: string,
): Promise<string | null> {
  if (!supabase) return 'Calling is not configured.'
  // Resolve via a SECURITY DEFINER RPC (single exact-match lookup) rather than a
  // table select — the profiles table is not publicly readable, to prevent email
  // harvesting. Returns the id scalar or null.
  const { data, error } = await supabase.rpc('lookup_profile_id', {
    lookup_email: email.trim().toLowerCase(),
  })
  if (error) return 'Could not look up that user.'
  if (!data) return 'No Manim account with that email.'

  const channel = supabase.channel(`user:${data as string}`)
  await channel.subscribe()
  await channel.send({ type: 'broadcast', event: 'ring', payload: { room, fromName } })
  await supabase.removeChannel(channel)
  return null
}

/** Fire a system notification for an incoming call when the tab is backgrounded
 *  (the in-app banner covers the focused case). Best-effort; silent if blocked. */
function notifyIncoming(fromName: string, room: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && !document.hidden) return
    const n = new Notification(`${fromName} is calling`, { body: `Room ${room}`, tag: 'mn-incoming' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* notifications unsupported / blocked */
  }
}

/**
 * Subscribe to this user's personal channel for incoming calls. Mount once,
 * app-wide (CallController). No-op for guests / unconfigured Supabase.
 */
export function useIncomingCalls() {
  const userId = useAuthStore((s) => s.userId)
  const signedIn = useAuthStore((s) => s.signedIn)
  const incoming = useCallStore((s) => s.incoming)
  const setIncoming = useCallStore((s) => s.setIncoming)
  const dismiss = useCallStore((s) => s.dismiss)

  useEffect(() => {
    const sb = supabase
    if (!sb || !signedIn) return
    // Ask once (best-effort) so backgrounded-tab rings can surface a system
    // notification; browsers may defer this until a user gesture.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {})
      }
    } catch {
      /* ignore */
    }
    const channel = sb.channel(`user:${userId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        const p = payload as IncomingCall
        if (p?.room) {
          setIncoming({ room: p.room, fromName: p.fromName || 'Someone' })
          notifyIncoming(p.fromName || 'Someone', p.room)
        }
      })
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, setIncoming])

  return { incoming, dismiss }
}
