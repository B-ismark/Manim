import { create } from 'zustand'

/**
 * Persisted media-device preferences (per browser). LiveKit's useMediaDeviceSelect
 * only tracks the ACTIVE device for the current room — nothing survived a rejoin, so
 * users re-picked their mic/speaker/camera every call. We remember the last-chosen
 * device per kind and re-apply it in-call (useAudioDeviceAutoswitch), and also let
 * a newly-connected Bluetooth device take over automatically.
 *
 * We store the label alongside the deviceId on purpose: deviceIds are NOT stable —
 * browsers rotate them per-session/permission-state, so a stored id often won't
 * match on the next visit. The label ("AirPods Pro") is the durable key we fall
 * back to when the id misses.
 */
export type StoredDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'

export interface RememberedDevice {
  deviceId: string
  label: string
}

type DeviceMap = Partial<Record<StoredDeviceKind, RememberedDevice>>

const PREFS_KEY = 'mn.devicePrefs'
const AUTO_BT_KEY = 'mn.autoBluetooth'

function loadDevices(): DeviceMap {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DeviceMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadAutoBluetooth(): boolean {
  try {
    // Default ON — "auto-connect Bluetooth when available" is the expected behaviour.
    return localStorage.getItem(AUTO_BT_KEY) !== '0'
  } catch {
    return true
  }
}

interface DeviceState {
  /** Last device the user (or auto-switch) settled on, per kind. */
  devices: DeviceMap
  /** When a Bluetooth headset appears, route audio to it automatically. */
  autoBluetooth: boolean
  remember: (kind: StoredDeviceKind, deviceId: string, label: string) => void
  setAutoBluetooth: (on: boolean) => void
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: loadDevices(),
  autoBluetooth: loadAutoBluetooth(),
  remember: (kind, deviceId, label) =>
    set((s) => {
      // 'default'/'communications' are OS-managed aliases, not a concrete pick —
      // don't pin them or we'd override the user's real device on the next visit.
      if (!deviceId || deviceId === 'default' || deviceId === 'communications') return s
      const devices = { ...s.devices, [kind]: { deviceId, label: label || '' } }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(devices))
      } catch {
        /* storage blocked — keep in memory only */
      }
      return { devices }
    }),
  setAutoBluetooth: (autoBluetooth) =>
    set(() => {
      try {
        localStorage.setItem(AUTO_BT_KEY, autoBluetooth ? '1' : '0')
      } catch {
        /* storage blocked */
      }
      return { autoBluetooth }
    }),
}))
