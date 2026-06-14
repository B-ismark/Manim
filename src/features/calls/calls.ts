import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'

export interface IncomingCall {
  room: string
  fromName: string
}

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
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (error) return 'Could not look up that user.'
  if (!data) return 'No Manim account with that email.'

  const channel = supabase.channel(`user:${data.id}`)
  await channel.subscribe()
  await channel.send({ type: 'broadcast', event: 'ring', payload: { room, fromName } })
  await supabase.removeChannel(channel)
  return null
}

/**
 * Subscribe to this user's personal channel for incoming calls. Mount once,
 * app-wide (CallController). No-op for guests / unconfigured Supabase.
 */
export function useIncomingCalls() {
  const userId = useAuthStore((s) => s.userId)
  const signedIn = useAuthStore((s) => s.signedIn)
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)

  useEffect(() => {
    const sb = supabase
    if (!sb || !signedIn) return
    const channel = sb.channel(`user:${userId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        const p = payload as IncomingCall
        if (p?.room) setIncoming({ room: p.room, fromName: p.fromName || 'Someone' })
      })
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn])

  const dismiss = useCallback(() => setIncoming(null), [])
  return { incoming, dismiss }
}
