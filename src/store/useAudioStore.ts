import { create } from 'zustand'

/**
 * The one piece of in-call audio state that outlives the event that caused it: a
 * microphone we could not get back.
 *
 * It needs a home outside the hook that detects it because two very separate
 * places have to show it — a banner in TopStack, and a badge on the control
 * bar's mic button — and because it must PERSIST. The original device-loss notice
 * was an eight-second toast: it expired while the fault didn't, leaving a dead
 * mic behind a control bar that still offered an ordinary "Unmute microphone".
 * Not being able to see the fault is what made it read as unrecoverable.
 *
 * Cleared the moment the mic works again (useMediaDeviceWatch watches the live
 * track for that), so nothing here can outlive the problem either.
 */
export interface MicFault {
  /** The device that went away — named in the banner, since that's what the user did. */
  lost: string
  /**
   * - `no-device` — nothing to fall back to; no other input is connected.
   * - `blocked` — the OS/browser has revoked microphone permission.
   * - `acquire-failed` — a device is listed but wouldn't open.
   */
  reason: 'no-device' | 'blocked' | 'acquire-failed'
  /**
   * Was the user actually transmitting when it broke? Drives how loudly we say
   * so: a headset switched off while already muted needs the badge, not a banner
   * across the call.
   */
  wasLive: boolean
}

interface AudioState {
  micFault: MicFault | null
  setMicFault: (fault: MicFault | null) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  micFault: null,
  setMicFault: (micFault) => set({ micFault }),
}))

/** Non-React entry point, so device hooks can record a fault without a selector. */
export function setMicFault(fault: MicFault | null): void {
  useAudioStore.getState().setMicFault(fault)
}
