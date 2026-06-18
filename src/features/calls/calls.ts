import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useCallStore, type IncomingCall } from '@/store/useCallStore'
import { useNotifyStore } from '@/store/useNotifyStore'
import type { RoomSecrets } from '@/lib/roomLink'

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
  /** Invite secrets for the room, relayed to the callee so they pass the join-secret
   *  gate and get the E2EE key. Requires the 5-arg `ring` RPC (see DEPLOY.md §4b). */
  secrets: RoomSecrets = {},
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

  // Broadcast the ring SERVER-SIDE via a SECURITY DEFINER RPC that verifies the
  // caller is an accepted contact of the target, then writes into the target's
  // private channel. The sender never joins that channel (no harvest), and
  // non-contacts can't ring (share the invite link instead).
  const { data: result, error: ringErr } = await supabase.rpc('ring', {
    target_id: data as string,
    room,
    from_name: fromName,
    join_secret: secrets.secret ?? null,
    e2ee_key: secrets.e2ee ?? null,
  })
  if (ringErr) return 'Could not place the call.'
  if (result === 'not_contact') {
    return 'You can only ring your contacts. Add them, or share the invite link instead.'
  }

  // Best-effort background Web Push so the ring reaches a backgrounded / mobile /
  // closed-tab device too (the Realtime broadcast above only lands on a live tab).
  // The server re-checks accepted-contact via our access token; fire-and-forget.
  void (async () => {
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) return
      await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: data as string, room, fromName, accessToken: token }),
      })
    } catch {
      /* push is a bonus; the in-app ring already fired */
    }
  })()
  return null
}

/** Fire a system notification for an incoming call when the tab is backgrounded
 *  (the in-app banner covers the focused case). Best-effort; silent if blocked. */
function notifyIncoming(fromName: string, room: string) {
  try {
    if (!useNotifyStore.getState().enabled) return
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
    // Notification permission is requested on a user gesture from Settings
    // (useNotifyStore), never auto-prompted here — non-gesture requests get
    // re-surfaced by browsers every session, which is the nag we're killing.
    // Private: Realtime RLS lets only this user receive on their own user:<id>
    // channel, and only the SECURITY DEFINER `ring` RPC (contact-gated) can write
    // to it — so no one can ring-spam or harvest by joining someone else's channel.
    const channel = sb.channel(`user:${userId}`, { config: { private: true, broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        const p = payload as IncomingCall
        if (p?.room) {
          setIncoming({ room: p.room, fromName: p.fromName || 'Someone', secret: p.secret, e2ee: p.e2ee })
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
