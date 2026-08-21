import { Track, type LocalAudioTrack, type Room } from 'livekit-client'
import { useDeviceStore } from '@/store/useDeviceStore'
import { addBreadcrumb } from '@/lib/report'

/**
 * Getting a microphone back after the platform took it away.
 *
 * Two independent LiveKit behaviours combine to strand the mic for the rest of a
 * call, and both are why "the mic dies when I toggle my Bluetooth headset and
 * nothing brings it back":
 *
 *  1. `room.switchActiveDevice(kind, id)` defaults to **exact: true**, so every
 *     pick — the Bluetooth auto-route and a manual choice alike — stores the
 *     capture constraint as `{ exact: deviceId }`. The moment that device is
 *     gone the constraint is unsatisfiable, and every later acquire (an unmute,
 *     a re-enable, a rejoin) throws OverconstrainedError instead of falling back
 *     to a mic that exists.
 *  2. LiveKit does rescue a *live* track by restarting it, but it skips that
 *     rescue on Chrome whenever the track is muted (`selectDefaultDevices` bails
 *     early for `audioinput` off Safari), and in neither case does it clear the
 *     room-level constraint. So the pin outlives the rescue.
 *
 * `recoverMicrophone` is the one way back: repoint the room at a device that is
 * actually present — **non-exact**, so the browser may fall back rather than
 * throw — then make the track live again if the caller says it was.
 *
 * It also re-asserts the capture defaults, which is not cosmetic. `restart()`
 * REPLACES the constraint set, and LiveKit's own rescue passes only
 * `{ deviceId: 'default' }` — so echo cancellation, noise suppression and
 * auto-gain were silently dropped for the remainder of any call that survived a
 * device loss. That is what turns a recovered call into an echo chamber.
 */

/** The browser-DSP capture set `roomOptions()` asks for at join, re-asserted on
 *  every restart because `restart()` replaces constraints wholesale. */
export const AUDIO_CAPTURE_DEFAULTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const

export type MicRecovery =
  | { ok: true; label: string }
  | { ok: false; reason: 'no-device' | 'blocked' | 'acquire-failed' }

/**
 * Has the OS/browser revoked microphone permission? Worth distinguishing: a
 * blocked mic can't be fixed by picking a different device, so the UI shouldn't
 * offer that. Not supported everywhere (Safari and Firefox throw on the
 * `microphone` name) — an unknown answer is treated as "not blocked", which
 * only costs an extra option in a message.
 */
async function micBlocked(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'denied'
  } catch {
    return false
  }
}

/**
 * Which input to fall back to, most-conservative first: stay on the active
 * device if it's still there, else the user's remembered pick (by id, else by
 * durable label — ids rotate, labels don't), else the OS default, else anything.
 *
 * Deliberately does NOT `remember()` what it picks: a forced fallback isn't a
 * choice, and pinning it would stop the user's real headset being restored when
 * it reconnects.
 */
function pickInput(inputs: MediaDeviceInfo[], activeId: string | undefined): MediaDeviceInfo {
  const byId = (id: string | undefined) => (id ? inputs.find((d) => d.deviceId === id) : undefined)
  const remembered = useDeviceStore.getState().devices.audioinput
  return (
    byId(activeId) ??
    byId(remembered?.deviceId) ??
    (remembered?.label
      ? inputs.find((d) => d.label && d.label === remembered.label)
      : undefined) ??
    byId('default') ??
    inputs[0]
  )
}

export function micTrack(room: Room): LocalAudioTrack | undefined {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
  return pub?.track as LocalAudioTrack | undefined
}

/** True when this track can't be carrying audio right now: dead, muted by the OS
 *  (an interruption, not the user), or its upstream replaced with null. */
export function trackNeedsRecovery(track: LocalAudioTrack): boolean {
  const mst = track.mediaStreamTrack
  return mst.readyState !== 'live' || mst.muted || track.isUpstreamPaused
}

/**
 * Is there no microphone we can rely on? True when the track is broken AND when
 * there is no track at all — with the mic off there is nothing to repair yet, but
 * the room's pinned capture constraint still has to be cleared or the next
 * enable will re-request a device that has gone.
 */
export function micUnusable(room: Room): boolean {
  const track = micTrack(room)
  return !track || trackNeedsRecovery(track)
}

async function run(room: Room, intent: { restoreLive: boolean }): Promise<MicRecovery> {
  const md = navigator.mediaDevices
  if (!md?.enumerateDevices) return { ok: false, reason: 'no-device' }

  let inputs: MediaDeviceInfo[]
  try {
    inputs = (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId)
  } catch {
    return { ok: false, reason: 'no-device' }
  }
  if (inputs.length === 0) return { ok: false, reason: 'no-device' }

  const target = pickInput(inputs, room.getActiveDevice('audioinput'))
  addBreadcrumb('microphone recovery', { label: target.label, restoreLive: intent.restoreLive })

  // Repoint with exact:false — this is the whole point. It rewrites both
  // `audioCaptureDefaults.deviceId` and the track's own constraint, so nothing
  // downstream re-requests the device that just vanished.
  try {
    await room.switchActiveDevice('audioinput', target.deviceId, false)
  } catch {
    // No publication to restart, or the browser refused the switch. The steps
    // below still try to produce a working mic.
  }

  try {
    const track = micTrack(room)
    if (track) {
      const mst = track.mediaStreamTrack
      // switchActiveDevice can't restart a track it believes is muted (it only
      // marks a pending device change), so do it here with the full constraint
      // set. `mst.muted` counts as dead: that's the platform saying the device
      // is producing nothing — an OS-level interruption — and only a fresh
      // capture clears it.
      if (mst.readyState !== 'live' || mst.muted) {
        await track.restartTrack({ deviceId: target.deviceId, ...AUDIO_CAPTURE_DEFAULTS })
      }
      // A track muted for 5s makes LiveKit replace the outgoing track with null,
      // and it only ever undoes that on the MediaStreamTrack's `unmute` event —
      // which mobile Safari frequently never fires after an interruption. Left
      // alone, the mic looks perfectly fine locally while nobody can hear you.
      if (track.isUpstreamPaused) await track.resumeUpstream()
    }
    // Read the intent late: a repoint-only run already in flight may have been
    // upgraded by a second caller that needs the mic live (see recoverMicrophone).
    if (intent.restoreLive) await room.localParticipant.setMicrophoneEnabled(true)
  } catch {
    return { ok: false, reason: (await micBlocked()) ? 'blocked' : 'acquire-failed' }
  }

  // Whatever route got us here, put the DSP back. Cheap on a live track — no
  // second getUserMedia — and Safari may simply reject it, which is fine.
  const live = micTrack(room)?.mediaStreamTrack
  if (live?.readyState === 'live') {
    await live.applyConstraints(AUDIO_CAPTURE_DEFAULTS).catch(() => {})
  }

  return { ok: true, label: target.label || 'your microphone' }
}

let inFlight: { promise: Promise<MicRecovery>; restoreLive: boolean } | null = null

/**
 * Repoint + revive the microphone. Safe to call from several places at once:
 * `devicechange` and the track's own `ended` event fire for the SAME unplug and
 * both want recovery, so runs are coalesced rather than racing two getUserMedia
 * calls over one microphone. The stronger intent wins — a caller that needs the
 * mic live again upgrades a repoint-only run already in flight.
 *
 * @param restoreLive unmute/re-enable the mic when done. Pass the user's state
 *   from BEFORE the failure: never unmute someone who muted themselves.
 */
export function recoverMicrophone(room: Room, restoreLive: boolean): Promise<MicRecovery> {
  if (inFlight) {
    if (restoreLive) inFlight.restoreLive = true
    return inFlight.promise
  }
  const intent = { restoreLive, promise: undefined as unknown as Promise<MicRecovery> }
  intent.promise = run(room, intent).finally(() => {
    inFlight = null
  })
  inFlight = intent
  return intent.promise
}

/** Test/teardown seam — drops any coalesced run so state can't leak across calls. */
export function resetMicRecovery(): void {
  inFlight = null
}
