import { supabase } from '@/lib/supabase'
import type { RoomSecrets } from '@/lib/roomLink'
import { isSealed, openSealed, sealFor, sealedFor, type DeviceKey } from '@/lib/sealedSecrets'
import { getDeviceKey } from '@/lib/deviceKey'
import { devicesOf, NOT_DEPLOYED } from '@/features/calls/deviceKeys'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import { useRecentRoomsStore, type RecentRoom } from '@/store/useRecentRoomsStore'

/**
 * Recent calls, shared across a signed-in account's devices.
 *
 * The list used to live in one browser's localStorage, so the calls you made on
 * your phone never showed up on your laptop. It now also lives in Supabase
 * (`recent_calls`, DEPLOY.md §4f), one row per room.
 *
 * What the server holds: the room's slug and display name, when you were last in
 * it, and whether it's encrypted. What it never holds: the join secret or the E2EE
 * key. Those are SEALED to the account's registered devices (lib/sealedSecrets),
 * the same way rings and presence carry them, so Supabase stores ciphertext only.
 *
 * A device that registered after a row was sealed can't open it. Any device that
 * CAN open it re-seals it for the current device list as it reads, so the list
 * heals itself the next time your phone opens the home screen.
 *
 * Everything here is best effort and silent: no table yet, no network, or a guest
 * all leave the local list working exactly as before.
 */

const TABLE = 'recent_calls'
/** How often the home screen may re-read the list (it also reads after sign-in). */
const PULL_EVERY_MS = 60_000
let lastPull = 0
let missing = false

function ready() {
  const sb = supabase
  const { signedIn, userId } = useAuthStore.getState()
  if (!sb || !signedIn || !userId || missing) return null
  return { sb, userId }
}

function notDeployed(error: { code?: string } | null): boolean {
  if (error?.code && NOT_DEPLOYED.has(error.code)) missing = true
  return missing
}

async function seal(devices: DeviceKey[], secrets: RoomSecrets): Promise<string | null> {
  if (!secrets.secret && !secrets.e2ee) return null
  return sealFor(devices, secrets)
}

/** Record (or refresh) a room on the account. Called once per connected call. */
export async function pushRecent(room: RecentRoom): Promise<void> {
  const r = ready()
  if (!r) return
  if (room.slug.length > 128) return // the table's limit; such a slug is never typed
  try {
    const hasSecrets = Boolean(room.secret || room.e2ee)
    const sealed = hasSecrets ? await seal(await devicesOf(r.sb, r.userId), room) : null
    // Secrets but nothing to seal them to (no device on file, or the lookup
    // failed): sync the name only, and leave any earlier seal in place rather
    // than overwrite good ciphertext with nothing. Never the keys in the clear.
    const { error } = await r.sb.from(TABLE).upsert(
      {
        user_id: r.userId,
        slug: room.slug,
        name: room.name.slice(0, 200),
        ...(sealed || !hasSecrets ? { sealed } : {}),
        e2ee: Boolean(room.e2ee),
        last_at: new Date(room.ts).toISOString(),
      },
      { onConflict: 'user_id,slug' },
    )
    notDeployed(error)
  } catch {
    /* offline — the local list still has it */
  }
}

/** Remove a room from the account's list (the ✕ on a recent call). */
export async function removeRecent(slug: string): Promise<void> {
  const r = ready()
  if (!r) return
  try {
    const { error } = await r.sb.from(TABLE).delete().match({ user_id: r.userId, slug })
    notDeployed(error)
  } catch {
    /* offline */
  }
}

interface Row {
  slug: string
  name: string | null
  sealed: string | null
  last_at: string
}

/**
 * Merge the account's list into this device's. Throttled (`force` skips it).
 * Local secrets are kept when the remote copy can't be opened here, and the newer
 * timestamp wins either way.
 */
export async function pullRecents(force = false): Promise<void> {
  const r = ready()
  if (!r) return
  if (!force && Date.now() - lastPull < PULL_EVERY_MS) return
  lastPull = Date.now()
  try {
    const { data, error } = await r.sb
      .from(TABLE)
      .select('slug,name,sealed,last_at')
      .order('last_at', { ascending: false })
      .limit(12)
    if (notDeployed(error) || error || !Array.isArray(data)) return
    const rows = data as Row[]
    const key = await getDeviceKey()
    const deviceId = useAppStore.getState().deviceId
    let devices: DeviceKey[] | null = null

    const remote: RecentRoom[] = []
    for (const row of rows) {
      const ts = Date.parse(row.last_at)
      if (!row.slug || !Number.isFinite(ts)) continue
      let secrets: RoomSecrets = {}
      if (row.sealed && isSealed(row.sealed) && key) {
        secrets = (await openSealed(row.sealed, deviceId, key.privateKey, key.publicJwk).catch(() => null)) ?? {}
        // Opened here: make sure every CURRENT device can open it too, so a laptop
        // that signed in after this row was written gets it on its next look.
        if (secrets.secret || secrets.e2ee) {
          devices ??= await devicesOf(r.sb, r.userId)
          if (devices.some((d) => !sealedFor(row.sealed!, d.deviceId))) {
            const resealed = await seal(devices, secrets)
            if (resealed) {
              await r.sb.from(TABLE).update({ sealed: resealed }).match({ user_id: r.userId, slug: row.slug })
            }
          }
        }
      }
      remote.push({ slug: row.slug, name: row.name || row.slug, ts, ...secrets })
    }
    useRecentRoomsStore.getState().merge(remote)
  } catch {
    /* offline */
  }
}
