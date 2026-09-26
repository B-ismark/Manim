import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import type { RoomSecrets } from '@/lib/roomLink'
import { deviceKeyRegistered, openSecrets, secretsFor } from '@/features/calls/deviceKeys'

export interface DeviceMeeting extends RoomSecrets {
  room: string
  deviceId: string
}

/** Channel that mirrors a signed-in user's live sessions across their devices. */
function presenceChannelName(userId: string): string {
  return `presence:${userId}`
}

/**
 * While in a call, advertise it on the user's presence channel so their OTHER
 * signed-in devices can offer a quick join. Signed-in only (guests have no
 * stable cross-device id). No-op without Supabase.
 */
export function usePublishMeetingPresence(room: string, secrets: RoomSecrets = {}) {
  const userId = useAuthStore((s) => s.userId)
  const signedIn = useAuthStore((s) => s.signedIn)
  const deviceId = useAppStore((s) => s.deviceId)
  // Flatten so the effect re-runs if the link's secrets change, not on a new object.
  const { secret, e2ee } = secrets

  useEffect(() => {
    const sb = supabase
    if (!sb || !signedIn || !room) return
    const channel = sb.channel(presenceChannelName(userId), {
      // Private: Realtime RLS restricts presence:<id> to the owner, so only THIS
      // user's other devices can see it (no cross-user online-harvest). The join
      // secret / E2EE key ride along so the other device can rebuild the full
      // invite link and pass the server's join-secret gate — sealed below, so
      // not even the relay can read them.
      config: { presence: { key: deviceId }, private: true },
    })
    // The secrets are sealed to this account's OTHER registered devices, so the
    // relay never holds the call's key. A device that signs in mid-call has a key
    // the last seal didn't include, so a new device appearing re-seals.
    let live = true
    let subscribed = false
    // Coalesced: subscribing replays a join for every device already there.
    let queued: ReturnType<typeof setTimeout> | undefined
    let latest = 0
    const publish = () => {
      clearTimeout(queued)
      queued = setTimeout(async () => {
        // Only the newest seal is tracked: an older lookup still in flight may
        // be missing the device whose arrival started this one.
        const mine = ++latest
        const sent = await secretsFor(sb, userId, { secret, e2ee }, deviceId)
        if (live && subscribed && mine === latest) void channel.track({ room, deviceId, ...sent })
      }, 250)
    }
    channel.on('presence', { event: 'join' }, ({ key }) => {
      if (key !== deviceId) publish()
    })
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      subscribed = true
      publish()
    })
    return () => {
      live = false
      clearTimeout(queued)
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, deviceId, room, secret, e2ee])
}

/**
 * Rooms this user is currently in on OTHER devices (for an idle "join your other
 * meeting" prompt). Empty for guests / unconfigured Supabase.
 */
export function useOtherDeviceMeetings(): DeviceMeeting[] {
  const userId = useAuthStore((s) => s.userId)
  const signedIn = useAuthStore((s) => s.signedIn)
  const deviceId = useAppStore((s) => s.deviceId)
  const [meetings, setMeetings] = useState<DeviceMeeting[]>([])

  useEffect(() => {
    const sb = supabase
    if (!sb || !signedIn) {
      setMeetings([])
      return
    }
    const channel = sb.channel(presenceChannelName(userId), {
      config: { presence: { key: deviceId }, private: true },
    })
    let live = true
    let generation = 0
    const sync = () => {
      const state = channel.presenceState<{
        room?: string
        deviceId?: string
        secret?: string
        e2ee?: string
      }>()
      const rooms: DeviceMeeting[] = []
      for (const key of Object.keys(state)) {
        if (key === deviceId) continue // skip this device
        for (const p of state[key]) {
          if (p.room) rooms.push({ room: p.room, deviceId: p.deviceId || key, secret: p.secret, e2ee: p.e2ee })
        }
      }
      // Open what was sealed for this device (the newest sync wins), THEN de-dupe
      // by room: the same call open on two other devices is one entry, and the
      // copy we can open beats one sealed before this device had a key.
      const mine = ++generation
      void Promise.all(
        rooms.map(async (m) => {
          const opened = await openSecrets(m)
          return opened ? { room: m.room, deviceId: m.deviceId, ...opened } : null
        }),
      ).then((all) => {
        if (!live || mine !== generation) return
        const open = all
          .filter((m): m is DeviceMeeting => m !== null)
          .sort((a, b) => Number(Boolean(b.secret || b.e2ee)) - Number(Boolean(a.secret || a.e2ee)))
        setMeetings(open.filter((m, i) => open.findIndex((x) => x.room === m.room) === i))
      })
    }
    channel.on('presence', { event: 'sync' }, sync)
    // Join only once this device's key is published: our arrival is what makes a
    // device in a call re-seal its secrets, and it can only include keys it finds.
    void deviceKeyRegistered().then(() => {
      if (!live) return
      channel.subscribe((status) => {
        // Present but advertising no room of our own (we're idle here).
        if (status === 'SUBSCRIBED') void channel.track({ deviceId })
      })
    })
    return () => {
      live = false
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, deviceId])

  return meetings
}
