import type { SupabaseClient } from '@supabase/supabase-js'
import type { RoomSecrets } from '@/lib/roomLink'
import { getDeviceKey } from '@/lib/deviceKey'
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

/** Publish this browser's public key for the signed-in account. Once per session. */
export function registerDeviceKey(sb: SupabaseClient, userId: string): Promise<void> {
  const deviceId = useAppStore.getState().deviceId
  const tag = `${userId}:${deviceId}`
  if (registeredFor === tag) return registration
  registeredFor = tag
  registration = (async () => {
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
  return registration
}

/** Remove this browser's published key (before sign-out, while the session is valid). */
export async function unregisterDeviceKey(sb: SupabaseClient, userId: string): Promise<void> {
  registeredFor = null
  const deviceId = useAppStore.getState().deviceId
  await sb.from('device_keys').delete().match({ user_id: userId, device_id: deviceId })
}

async function devicesOf(sb: SupabaseClient, userId: string): Promise<DeviceKey[]> {
  const { data, error } = await sb.rpc('get_device_keys', { target_id: userId })
  if (error || !Array.isArray(data)) return []
  return data
    .filter((r) => r && typeof r.device_id === 'string' && r.public_key && typeof r.public_key === 'object')
    .map((r) => ({ deviceId: r.device_id as string, publicJwk: r.public_key as JsonWebKey }))
}

/**
 * The secrets as they should travel to `userId`'s devices: sealed into `e2ee`
 * (and `secret` empty) when they have registered devices, otherwise unchanged.
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
 * A sealed payload that isn't for this device gives back no secrets at all, never
 * the sealed string as if it were a key.
 */
export async function openSecrets(p: RoomSecrets): Promise<RoomSecrets> {
  if (!isSealed(p.e2ee)) return p
  const key = await getDeviceKey()
  const deviceId = useAppStore.getState().deviceId
  const opened = key ? await openSealed(p.e2ee, deviceId, key.privateKey) : null
  return opened ?? {}
}
