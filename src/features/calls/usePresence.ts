import { useEffect } from 'react'
import { create } from 'zustand'
import { addBreadcrumb } from '@/lib/report'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import type { RoomSecrets } from '@/lib/roomLink'
import { isSealed, sealedFor } from '@/lib/sealedSecrets'
import { deviceKeyRegistered, openSecrets, refreshDeviceKey, secretsFor } from '@/features/calls/deviceKeys'

export interface DeviceMeeting extends RoomSecrets {
  room: string
  deviceId: string
}

/** Channel that mirrors a signed-in user's live sessions across their devices. */
function presenceChannelName(userId: string): string {
  return `presence:${userId}`
}

/** The call THIS device is in right now, if any — what the channel advertises. */
const useLiveCallStore = create<{ room: string | null; secret?: string; e2ee?: string }>(() => ({ room: null }))

/** Calls running on this account's OTHER devices, from the one app-wide listener. */
const useOtherDevicesStore = create<{ meetings: DeviceMeeting[] }>(() => ({ meetings: [] }))

/**
 * While in a call, advertise it so this user's OTHER signed-in devices can offer a
 * quick join. Signed-in only (guests have no stable cross-device id).
 *
 * This only says WHAT to advertise. The channel itself is owned by
 * `useDevicePresence`, mounted once for the whole app: a separate channel per
 * hook meant the idle listener and the call's publisher both asked for the same
 * topic the moment a call started, and the realtime client hands a second caller
 * the first one's channel while it is still closing, so the call could end up
 * publishing on a dead socket.
 */
export function usePublishMeetingPresence(room: string, secrets: RoomSecrets = {}) {
  // Flatten so the effect re-runs if the link's secrets change, not on a new object.
  const { secret, e2ee } = secrets
  useEffect(() => {
    if (!room) return
    useLiveCallStore.setState({ room, secret, e2ee })
    return () => useLiveCallStore.setState({ room: null, secret: undefined, e2ee: undefined })
  }, [room, secret, e2ee])
}

/**
 * Rooms this user is currently in on OTHER devices. Any screen can read it; the
 * subscription behind it is `useDevicePresence`. Empty for guests / no Supabase.
 */
export function useOtherDeviceMeetings(): DeviceMeeting[] {
  return useOtherDevicesStore((s) => s.meetings)
}

/** How many times, and how far apart, to ask a device in a call to seal again. */
const RESEAL_ASKS_MS = [1500, 5000, 15000]

/**
 * The app's one connection to this user's presence channel. Mount ONCE (App).
 *
 * Every device is present on it, idle or in a call. A device in a call advertises
 * the room with its secrets sealed to the account's OTHER registered devices, so
 * the relay never holds the call's key; any device arriving (or re-announcing)
 * makes it re-seal, so a device that signed in mid-call gets a copy it can open.
 *
 * Two gaps this closes:
 * - It used to listen only while the home screen was open, so a laptop on any
 *   other screen never heard about the call on your phone.
 * - An entry this device couldn't open (sealed before its key was on file: the
 *   key upload gets 3s before presence goes ahead without it) was dropped with
 *   nothing to make the phone seal again. Now this device re-publishes its key
 *   and re-announces itself, which is exactly the event the phone re-seals on.
 */
export function useDevicePresence() {
  const userId = useAuthStore((s) => s.userId)
  const signedIn = useAuthStore((s) => s.signedIn)
  const deviceId = useAppStore((s) => s.deviceId)

  useEffect(() => {
    const sb = supabase
    const setMeetings = (meetings: DeviceMeeting[]) => useOtherDevicesStore.setState({ meetings })
    if (!sb || !signedIn) {
      setMeetings([])
      return
    }
    const channel = sb.channel(presenceChannelName(userId), {
      // Private: Realtime RLS restricts presence:<id> to the owner, so only THIS
      // user's other devices can see it (no cross-user online-harvest).
      config: { presence: { key: deviceId }, private: true },
    })
    let live = true
    let subscribed = false

    // What this device says about itself. Coalesced: subscribing replays a join
    // for every device already there, and only the newest seal is tracked (an
    // older lookup still in flight may be missing the device that started this).
    let asks = 0
    let queued: ReturnType<typeof setTimeout> | undefined
    let latest = 0
    /** The sealed value last advertised, to tell who it already covers. */
    let lastSealed: string | undefined
    const announce = () => {
      clearTimeout(queued)
      queued = setTimeout(async () => {
        const mine = ++latest
        const call = useLiveCallStore.getState()
        let payload: Record<string, unknown>
        if (call.room) {
          const sent = await secretsFor(sb, userId, { secret: call.secret, e2ee: call.e2ee }, deviceId)
          if (mine === latest) lastSealed = isSealed(sent.e2ee) ? sent.e2ee : undefined
          payload = { room: call.room, deviceId, ...sent }
        } else {
          lastSealed = undefined
          payload = { deviceId, ...(asks ? { ask: asks } : {}) }
        }
        if (live && subscribed && mine === latest) void channel.track(payload)
      }, 250)
    }

    // An entry we couldn't open: publish our key again and re-announce, which is
    // a presence join for our key on the other side, i.e. its cue to re-seal.
    let askTimer: ReturnType<typeof setTimeout> | undefined
    const askForReseal = () => {
      if (askTimer || asks >= RESEAL_ASKS_MS.length || useLiveCallStore.getState().room) return
      askTimer = setTimeout(async () => {
        askTimer = undefined
        asks++
        await refreshDeviceKey(sb, userId)
        if (live) announce()
      }, RESEAL_ASKS_MS[asks])
    }

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
        if (all.some((m) => m === null)) askForReseal()
        else asks = 0 // everything opened: a later call gets its own asks
        const open = all
          .filter((m): m is DeviceMeeting => m !== null)
          .sort((a, b) => Number(Boolean(b.secret || b.e2ee)) - Number(Boolean(a.secret || a.e2ee)))
        setMeetings(open.filter((m, i) => open.findIndex((x) => x.room === m.room) === i))
      })
    }
    channel.on('presence', { event: 'sync' }, sync)
    // Another device arrived or re-announced: re-seal for it if we're in a call.
    //
    // Only when the seal needs it: a presence UPDATE is also a join, so two devices
    // both in calls would otherwise answer each other's re-seal forever. A newcomer
    // sees the current state without our help; what it can't do is open a seal
    // that leaves it out, or one made for a key it has since replaced (`ask`).
    //
    // An UPDATE arrives as a join too, with the old meta still in
    // `currentPresences`, so only a real arrival (nothing there before) or an
    // explicit ask counts. A plaintext fallback is already readable by whoever is
    // present, so answering updates would only feed a loop.
    channel.on('presence', { event: 'join' }, ({ key, currentPresences, newPresences }) => {
      const call = useLiveCallStore.getState()
      if (key === deviceId || !call.room || (!call.secret && !call.e2ee)) return
      const asked = newPresences.some((p) => Boolean((p as { ask?: unknown }).ask))
      const arrived = currentPresences.length === 0
      if (asked || (arrived && (!lastSealed || !sealedFor(lastSealed, key)))) announce()
    })
    // Joining or leaving a call on this device changes what we advertise.
    const unwatch = useLiveCallStore.subscribe((now, before) => {
      if (now.room !== before.room || now.secret !== before.secret || now.e2ee !== before.e2ee) announce()
    })
    // Join only once this device's key is published: our arrival is what makes a
    // device in a call re-seal its secrets, and it can only include keys it finds.
    void deviceKeyRegistered().then(() => {
      if (!live) return
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true
          announce()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          addBreadcrumb('device presence: ' + status)
        }
      })
    })
    return () => {
      live = false
      clearTimeout(queued)
      clearTimeout(askTimer)
      unwatch()
      setMeetings([])
      void sb.removeChannel(channel)
    }
  }, [userId, signedIn, deviceId])
}
