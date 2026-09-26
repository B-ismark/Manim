import { useEffect } from 'react'
import { getSupabase, supabase } from '@/lib/supabase'
import { lookupError } from '@/lib/lookupError'
import { useAuthStore } from '@/store/useAuthStore'
import { useCallStore, type IncomingCall } from '@/store/useCallStore'
import { useNotifyStore } from '@/store/useNotifyStore'
import { toast } from '@/store/useToastStore'
import type { RoomSecrets } from '@/lib/roomLink'
import { prettyRoom } from '@/lib/roomName'
import { devicesOf, openSecrets } from '@/features/calls/deviceKeys'
import { sealFor } from '@/lib/sealedSecrets'
import { checkDevices, type PinCheck } from '@/lib/devicePins'
import { askKeyChange, type KeyChangeKind } from '@/store/useKeyChangeStore'
import { useContactsStore } from '@/store/useContactsStore'

export type { IncomingCall }

/** A ring is a live event, not a sticky state: auto-miss after this long. */
const RING_TTL_MS = 45_000

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
  const supabase = await getSupabase()
  if (!supabase) return 'Calling isn’t available right now.'
  // Resolve via a SECURITY DEFINER RPC (single exact-match lookup) rather than a
  // table select — the profiles table is not publicly readable, to prevent email
  // harvesting. Returns the id scalar or null.
  const { data, error } = await supabase.rpc('lookup_profile_id', {
    lookup_email: email.trim().toLowerCase(),
  })
  if (error) return lookupError(error)
  if (!data) return 'No Manim account with that email.'

  // Broadcast the ring SERVER-SIDE via a SECURITY DEFINER RPC that verifies the
  // caller is an accepted contact of the target, then writes into the target's
  // private channel. The sender never joins that channel (no harvest), and
  // non-contacts can't ring (share the invite link instead).
  // The secrets are sealed to the callee's own devices when they have any
  // registered, so the relay (Supabase Realtime) never sees the call's key.
  const target = data as string
  const name = useContactsStore.getState().rows.find((r) => r.otherId === target)?.name || email
  let sent = secrets
  let check: PinCheck | null = null
  if (secrets.secret || secrets.e2ee) {
    const devices = await devicesOf(supabase, target)
    // Before sealing the call to their devices, compare them with the ones this
    // browser remembers (lib/devicePins). Anything this browser hasn't trusted
    // yet is asked about BEFORE sealing: afterwards the key is already out.
    check = await checkDevices(useAuthStore.getState().userId, target, devices).catch(() => null)
    const sealed = await sealFor(devices, secrets)
    // Devices we know of, and yet nothing to seal to: the key would travel
    // unprotected, which is exactly what hiding their devices would achieve.
    const kind: KeyChangeKind | null = !check
      ? null
      : !check.first && !sealed
        ? 'unprotected'
        : check.changed.length
          ? 'changed'
          : check.added.length
            ? 'added'
            : null
    if (kind && !(await askKeyChange(name, kind))) return `You didn’t ring ${name}.`
    if (sealed) sent = { e2ee: sealed }
  }
  const { data: result, error: ringErr } = await supabase.rpc('ring', {
    target_id: target,
    room,
    from_name: fromName,
    join_secret: sent.secret ?? null,
    e2ee_key: sent.e2ee ?? null,
  })
  if (ringErr) return 'Couldn’t place the call.'
  if (result === 'not_contact') {
    return 'You can only ring your contacts. Add them, or share the invite link instead.'
  }
  if (result !== 'ok') return 'Sign in again to place calls.'
  // Trusted from now on: only once the ring really went.
  check?.accept()

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
        body: JSON.stringify({ targetId: target, room, fromName, accessToken: token }),
      })
    } catch {
      /* push is a bonus; the in-app ring already fired */
    }
  })()
  return null
}

/**
 * Who's calling. The ring's `from` is stamped by the server (auth.uid() in the
 * ring function, DEPLOY.md §4g), while `fromName` is whatever the caller typed,
 * so any contact could otherwise ring as "Mum". With `from`, the name and email
 * are the ones on that contact's account, from your own contacts list. (A
 * profile name is still theirs to choose, which is why the email shows too.)
 * A server that doesn't stamp `from` yet falls back to the typed name.
 */
async function caller(from: unknown, typed: string | undefined): Promise<{ name: string; email?: string }> {
  const fallback = { name: typed || 'Someone' }
  if (typeof from !== 'string' || !from) return fallback
  const find = () =>
    useContactsStore.getState().rows.find((r) => r.otherId === from && r.direction === 'accepted')
  let row = find()
  if (!row) {
    // Not in the list we have: look once, but never hold a ring up for long.
    await Promise.race([
      useContactsStore.getState().refresh().catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ])
    row = find()
  }
  return row ? { name: row.name || fallback.name, email: row.email ?? undefined } : fallback
}

/** Fire a system notification for an incoming call when the tab is backgrounded
 *  (the in-app banner covers the focused case). Best-effort; silent if blocked. */
function notifyIncoming(fromName: string, room: string) {
  try {
    if (!useNotifyStore.getState().enabled) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && !document.hidden) return
    const n = new Notification(`${fromName} is calling`, { body: prettyRoom(room), tag: 'mn-incoming' })
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
    let live = true
    let latest = 0
    channel
      .on('broadcast', { event: 'ring' }, ({ payload }) => {
        const p = payload as IncomingCall & { from?: unknown }
        if (!p?.room) return
        const mine = ++latest
        void Promise.all([openSecrets({ secret: p.secret, e2ee: p.e2ee }), caller(p.from, p.fromName)]).then(
          ([opened, who]) => {
            // Stale (signed out, or a newer ring arrived first), or sealed for your
            // other devices only: this one couldn't answer it, so it doesn't ring.
            if (!live || mine !== latest || !opened) return
            setIncoming({ room: p.room, fromName: who.name, fromEmail: who.email, ...opened })
            notifyIncoming(who.name, p.room)
          },
        )
      })
      .subscribe()
    return () => {
      live = false
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, setIncoming])

  // Auto-miss: the caller has no cancel event (they join the room immediately
  // after ringing), so expiry is the callee-side safety net. Without it, a
  // callee who steps away returns to a stale ring — on touch a full-screen
  // takeover — hours later. 45s matches phone convention; the banner shows the
  // elapsed time so the countdown is visible before it fires.
  useEffect(() => {
    if (!incoming) return
    const t = window.setTimeout(() => {
      dismiss()
      toast(`Missed call from ${incoming.fromName}`, 'neutral')
    }, RING_TTL_MS)
    return () => window.clearTimeout(t)
  }, [incoming, dismiss])

  return { incoming, dismiss }
}
