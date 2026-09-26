import type { SupabaseClient } from '@supabase/supabase-js'
import type { RoomSecrets } from '@/lib/roomLink'
import { forgetDeviceKey, getDeviceKey } from '@/lib/deviceKey'
import { isSealed, openSealed, sealFor, type DeviceKey } from '@/lib/sealedSecrets'
import { useAppStore } from '@/store/useAppStore'

/**
 * Supabase side of sealed secrets: publishing this browser's public key, and
 * looking up the devices a ring or a presence update should be sealed for.
 * Everything here degrades to the old behaviour (secrets in the clear) when the
 * `device_keys` table or `get_device_keys` function isn't there yet (DEPLOY.md
 * §4e) or the recipient has no registered device, so ringing never breaks.
 */

let registeredFor: string | null = null
let registration: Promise<void> = Promise.resolve()
// Set while signing out: a token refresh landing in that window must not put
// back the row (and the key) that sign-out has just removed. The page reloads
// after sign-out, which clears it.
let stopped = false

/**
 * Publish this browser's public key for the signed-in account. Once per session.
 * `newAccount`: someone else was signed in here last, so start from a new pair
 * rather than carry theirs over.
 */
export function registerDeviceKey(sb: SupabaseClient, userId: string, newAccount = false): Promise<void> {
  const deviceId = useAppStore.getState().deviceId
  const tag = `${userId}:${deviceId}`
  if (stopped || registeredFor === tag) return registration
  registeredFor = tag
  registration = (async () => {
    if (newAccount) await forgetDeviceKey()
    const key = await getDeviceKey()
    const { error } = key
      ? await sb
          .from('device_keys')
          .upsert({ user_id: userId, device_id: deviceId, public_key: key.publicJwk }, { onConflict: 'user_id,device_id' })
      : { error: true }
    if (error && registeredFor === tag) registeredFor = null
  })().catch(() => {
    if (registeredFor === tag) registeredFor = null
  })
  return registration
}

/**
 * Settles once this browser's key is published (or publishing gave up). Presence
 * waits on it: a device that shows up before its key does gets sealed out of the
 * other device's re-seal.
 */
export function deviceKeyRegistered(): Promise<void> {
  // Never hold presence hostage to a stalled request: after 3s, go ahead.
  return Promise.race([registration, new Promise<void>((r) => setTimeout(r, 3000))])
}

/** Remove this browser's published key (before sign-out, while the session is valid). */
export async function unregisterDeviceKey(sb: SupabaseClient, userId: string): Promise<void> {
  stopped = true
  registeredFor = null
  const deviceId = useAppStore.getState().deviceId
  await sb.from('device_keys').delete().match({ user_id: userId, device_id: deviceId })
}

/** Postgres / PostgREST codes for "that function or table isn't there yet". */
const NOT_DEPLOYED = new Set(['PGRST202', '42883', '42P01', 'PGRST205'])

async function devicesOf(sb: SupabaseClient, userId: string): Promise<DeviceKey[]> {
  let { data, error } = await sb.rpc('get_device_keys', { target_id: userId })
  // A blip isn't "they have no devices": one retry before giving up on sealing.
  if (error && !NOT_DEPLOYED.has(error.code)) ({ data, error } = await sb.rpc('get_device_keys', { target_id: userId }))
  if (error || !Array.isArray(data)) return []
  return data
    .filter((r) => r && typeof r.device_id === 'string' && r.public_key && typeof r.public_key === 'object')
    .map((r) => ({ deviceId: r.device_id as string, publicJwk: r.public_key as JsonWebKey }))
}

/**
 * The secrets as they should travel to `userId`'s devices: sealed into `e2ee`
 * (and `secret` empty) when they have registered devices, otherwise unchanged —
 * which includes the lookup failing twice, so a call always gets through.
 * `exceptDevice` leaves one device out (your own, for presence).
 */
export async function secretsFor(
  sb: SupabaseClient,
  userId: string,
  secrets: RoomSecrets,
  exceptDevice?: string,
): Promise<RoomSecrets> {
  if (!secrets.secret && !secrets.e2ee) return secrets
  const devices = (await devicesOf(sb, userId)).filter((d) => d.deviceId !== exceptDevice)
  const sealed = await sealFor(devices, secrets)
  return sealed ? { e2ee: sealed } : secrets
}

/**
 * The secrets from a ring or presence payload, opened for this device when sealed.
 * Null when it's sealed but not openable here (sealed before this device had a
 * key, or for other devices): this device couldn't answer it, so the caller drops
 * it rather than offer a join that would fail. Never the sealed string as a key.
 */
export async function openSecrets(p: RoomSecrets): Promise<RoomSecrets | null> {
  if (!isSealed(p.e2ee)) return { secret: p.secret, e2ee: p.e2ee }
  const key = await getDeviceKey()
  const deviceId = useAppStore.getState().deviceId
  return key ? await openSealed(p.e2ee, deviceId, key.privateKey, key.publicJwk) : null
}
