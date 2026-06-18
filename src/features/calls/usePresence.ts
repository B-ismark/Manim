import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import type { RoomSecrets } from '@/lib/roomLink'

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
      // invite link and pass the server's join-secret gate — safe because the
      // channel is owner-only.
      config: { presence: { key: deviceId }, private: true },
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ room, deviceId, secret, e2ee })
    })
    return () => {
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
      // De-dupe by room (same call open on two other devices → one entry).
      setMeetings(rooms.filter((m, i) => rooms.findIndex((x) => x.room === m.room) === i))
    }
    channel.on('presence', { event: 'sync' }, sync)
    channel.subscribe((status) => {
      // Present but advertising no room of our own (we're idle here).
      if (status === 'SUBSCRIBED') void channel.track({ deviceId })
    })
    return () => {
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, deviceId])

  return meetings
}
