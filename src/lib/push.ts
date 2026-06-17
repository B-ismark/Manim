/*
  Web Push client glue: register the service worker, subscribe the browser to push,
  and persist the subscription to the signed-in user's account so the server can
  reach them when a contact rings (see server/webpush.mjs + the `ring` flow). The
  opt-in is governed by the same Settings toggle as foreground notifications
  (useNotifyStore). Degrades to a no-op when push isn't configured/supported.
*/
import { supabase } from '@/lib/supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** True only when the VAPID public key is built in AND the browser supports push. */
export function pushSupported(): boolean {
  return (
    Boolean(VAPID_PUBLIC) &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

/**
 * Subscribe to Web Push and store the subscription on the user's account. Safe to
 * call repeatedly (upsert by endpoint). No-op for guests / unsupported / not
 * configured. Assumes Notification permission is already granted (the caller —
 * useNotifyStore.enable — requests it on the user's gesture first).
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported() || !supabase) return
  const reg = await registerSW()
  if (!reg) return
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC as string) as BufferSource,
      })
      .catch(() => null)
  }
  if (!sub) return
  const keys = sub.toJSON().keys ?? {}
  // user_id defaults to auth.uid() server-side (RLS); we only send the endpoint+keys.
  await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: sub.endpoint, p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' }, { onConflict: 'endpoint' })
    .then(() => {})
}

/** Unsubscribe + drop the stored subscription (called when the toggle is turned off). */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  } catch {
    /* nothing to clean up */
  }
}
