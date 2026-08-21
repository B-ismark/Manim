import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { toast } from '@/store/useToastStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useDeviceStore, type StoredDeviceKind } from '@/store/useDeviceStore'
import { useRoomStore } from '@/store/useRoomStore'
import { isBluetoothLabel } from '@/lib/bluetooth'
import { addBreadcrumb } from '@/lib/report'
import { micUnusable, recoverMicrophone } from '@/lib/audioRecovery'

const KINDS = ['audioinput', 'audiooutput', 'videoinput'] as const satisfies readonly StoredDeviceKind[]

function kindNoun(kind: StoredDeviceKind): string {
  return kind === 'audioinput' ? 'microphone' : kind === 'audiooutput' ? 'speaker' : 'camera'
}

/**
 * Automatic device routing (in-call).
 *
 * Two behaviours the user asked for, both keyed off the `devicechange` signal:
 *   1. Auto-connect Bluetooth — when a headset connects (at join, or plugged in
 *      mid-call), route mic + speaker to it. AUDIO ONLY (there's no such thing for a
 *      camera). Gated by the `autoBluetooth` pref (default on; toggle in the audio menu).
 *   2. Remember choices — a previously chosen device (by id, else by durable label)
 *      that re-appears is restored, so users don't re-pick their mic/speaker/CAMERA
 *      each call.
 *
 * We only switch on the INITIAL scan or when a device NEWLY arrives — never on every
 * devicechange — so a manual mid-call pick (e.g. deliberately moving off the headset,
 * or to a second webcam) is respected and not yanked back. switchActiveDevice restarts
 * the affected track, so gating on arrivals also keeps the camera/mic from needlessly
 * flickering. Output switching (setSinkId) is unsupported on some browsers (iOS Safari,
 * Firefox); switchActiveDevice resolves false / throws there and we simply skip it.
 *
 * Mount once inside the LiveKitRoom provider (RoomView), alongside useMediaDeviceWatch.
 */
export function useDeviceAutoswitch() {
  const room = useRoomContext()
  const announce = useAnnounce()

  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let cancelled = false
    // deviceIds present on the previous scan, so we can tell arrivals from residents.
    let seen = new Set<string>()

    async function switchTo(
      kind: StoredDeviceKind,
      device: MediaDeviceInfo,
      reason: 'bluetooth' | 'remembered',
    ) {
      try {
        // exact:false, deliberately. LiveKit's default is exact:true, which
        // stores the capture constraint as `{ exact: deviceId }` — and a device
        // WE chose automatically must never be able to strand the mic when it
        // goes away (see lib/audioRecovery). Non-exact still verifies: LiveKit
        // compares the resulting track's settings and returns false if the
        // browser landed somewhere else, so we don't claim a switch we didn't
        // make. A MANUAL pick keeps exact — that one is a promise to the user.
        const ok = await room.switchActiveDevice(kind, device.deviceId, false)
        if (cancelled || !ok) return false
        useDeviceStore.getState().remember(kind, device.deviceId, device.label)
        const noun = kindNoun(kind)
        const name = device.label || 'device'
        addBreadcrumb('device auto-switch', { kind, reason, label: device.label })
        if (reason === 'bluetooth') {
          toast(`Connected ${noun} to ${name}`, 'neutral')
          announce(`${name} connected — ${noun} switched`, 'polite')
        } else {
          announce(`${noun} restored to ${name}`, 'polite')
        }
        return true
      } catch {
        // Device vanished mid-switch, or the browser can't set this sink — ignore.
        return false
      }
    }

    async function reconcile(initial: boolean) {
      // A muted companion (same account on another device) isn't using local mic/cam/
      // speaker — auto-routing would fight the deliberate mute. Skip until the user
      // takes over audio (clears companion), then normal routing resumes.
      if (useRoomStore.getState().companion) return
      let devices: MediaDeviceInfo[]
      try {
        devices = await md.enumerateDevices()
      } catch {
        return
      }
      if (cancelled) return
      const { autoBluetooth, devices: prefs } = useDeviceStore.getState()

      // A departure nobody was watching: the active INPUT disappeared while
      // there was no live mic track to raise an `ended` event — the mic was off,
      // or already dead. Nothing else repoints it (LiveKit skips its own
      // audioinput fallback on Chrome, and never clears the room's pinned
      // constraint), so the next time the user turns the mic on it re-requests a
      // device that isn't there and fails. Repoint now, without touching mute
      // state. A loss with a live track belongs to useMediaDeviceWatch, which
      // also knows whether to bring the mic back up — recoverMicrophone
      // coalesces the two if both fire for one unplug.
      const activeInput = room.getActiveDevice('audioinput')
      const inputGone =
        !!activeInput && !devices.some((d) => d.kind === 'audioinput' && d.deviceId === activeInput)
      if (inputGone && micUnusable(room)) {
        await recoverMicrophone(room, false)
        if (cancelled) return
      }

      for (const kind of KINDS) {
        const list = devices.filter((d) => d.kind === kind && d.deviceId)
        if (list.length === 0) continue
        const active = room.getActiveDevice(kind)
        // On the first scan every device is "new"; afterwards only unseen ids count.
        const arrivals = initial ? list : list.filter((d) => !seen.has(d.deviceId))

        // 1) Bluetooth takes over when it appears (audio kinds only, pref permitting).
        if (autoBluetooth && kind !== 'videoinput') {
          const bt = arrivals.find((d) => isBluetoothLabel(d.label))
          if (bt && bt.deviceId !== active && (await switchTo(kind, bt, 'bluetooth'))) continue
        }

        // 2) Restore the remembered device (match by id, else by durable label).
        const remembered = prefs[kind]
        if (remembered) {
          const match =
            list.find((d) => d.deviceId === remembered.deviceId) ??
            (remembered.label
              ? list.find((d) => d.label && d.label === remembered.label)
              : undefined)
          // Only restore at join or when it just re-connected — don't fight a manual pick.
          const justArrived = match && arrivals.some((a) => a.deviceId === match.deviceId)
          if (match && match.deviceId !== active && (initial || justArrived)) {
            await switchTo(kind, match, 'remembered')
          }
        }
      }

      seen = new Set(devices.filter((d) => d.deviceId).map((d) => d.deviceId))
    }

    void reconcile(true)
    const onChange = () => void reconcile(false)
    md.addEventListener?.('devicechange', onChange)
    return () => {
      cancelled = true
      md.removeEventListener?.('devicechange', onChange)
    }
  }, [room, announce])
}
