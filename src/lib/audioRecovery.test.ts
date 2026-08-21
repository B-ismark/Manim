import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AUDIO_CAPTURE_DEFAULTS,
  micUnusable,
  recoverMicrophone,
  resetMicRecovery,
  trackNeedsRecovery,
} from '@/lib/audioRecovery'
import { useDeviceStore } from '@/store/useDeviceStore'

/*
 * These cover the exact shape of the Bluetooth-toggle bug, which no browser test
 * can reach: it needs a device to disappear from enumerateDevices mid-call.
 *
 * The behaviours that actually matter are all about NOT re-requesting a device
 * that has gone, and NOT unmuting someone who muted themselves — so that's what
 * is asserted, against a Room stubbed to LiveKit's real contract.
 */

interface FakeTrack {
  mediaStreamTrack: {
    readyState: 'live' | 'ended'
    muted: boolean
    applyConstraints: ReturnType<typeof vi.fn>
  }
  isMuted: boolean
  isUpstreamPaused: boolean
  restartTrack: ReturnType<typeof vi.fn>
  resumeUpstream: ReturnType<typeof vi.fn>
}

function fakeTrack(over: Partial<FakeTrack> = {}): FakeTrack {
  return {
    mediaStreamTrack: {
      readyState: 'live',
      muted: false,
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    },
    isMuted: false,
    isUpstreamPaused: false,
    restartTrack: vi.fn().mockResolvedValue(undefined),
    resumeUpstream: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function fakeRoom(opts: { active?: string; track?: FakeTrack | undefined } = {}) {
  const track = 'track' in opts ? opts.track : fakeTrack()
  const room = {
    active: opts.active ?? 'bt-airpods',
    switchActiveDevice: vi.fn(function (this: void, _kind: string, id: string) {
      room.active = id
      return Promise.resolve(true)
    }),
    getActiveDevice: (_kind: string) => room.active,
    localParticipant: {
      getTrackPublication: () => (track ? { track } : undefined),
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
    },
  }
  return room
}

/** enumerateDevices, minus the device the user just switched off. */
function devices(...labels: [id: string, label: string][]) {
  const list = labels.map(([deviceId, label]) => ({ deviceId, label, kind: 'audioinput' }))
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: { enumerateDevices: () => Promise.resolve(list) },
      permissions: { query: () => Promise.reject(new Error('unsupported')) },
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRoom = (r: ReturnType<typeof fakeRoom>) => r as any

beforeEach(() => {
  resetMicRecovery()
  useDeviceStore.setState({ devices: {} })
})

describe('recoverMicrophone', () => {
  it('repoints NON-exact, so a vanished device can never strand the next acquire', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const room = fakeRoom({ active: 'bt-airpods' })

    const r = await recoverMicrophone(asRoom(room), false)

    expect(r).toEqual({ ok: true, label: 'MacBook Pro Microphone' })
    // The third argument is the whole fix. LiveKit defaults it to true, which
    // stores { exact: deviceId } and makes every later getUserMedia throw once
    // that device is gone.
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'builtin', false)
  })

  it('stays on the active device when it is still connected', async () => {
    devices(['bt-airpods', 'AirPods Pro'], ['builtin', 'MacBook Pro Microphone'])
    const room = fakeRoom({ active: 'bt-airpods' })

    await recoverMicrophone(asRoom(room), false)

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'bt-airpods', false)
  })

  it('prefers the remembered device over the OS default', async () => {
    devices(['default', 'Default'], ['usb-yeti', 'Blue Yeti'])
    useDeviceStore.setState({ devices: { audioinput: { deviceId: 'usb-yeti', label: 'Blue Yeti' } } })
    const room = fakeRoom({ active: 'bt-airpods' })

    await recoverMicrophone(asRoom(room), false)

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'usb-yeti', false)
  })

  it('matches a remembered device by label when its id has rotated', async () => {
    devices(['default', 'Default'], ['fresh-id', 'Blue Yeti'])
    useDeviceStore.setState({ devices: { audioinput: { deviceId: 'stale-id', label: 'Blue Yeti' } } })
    const room = fakeRoom({ active: 'gone' })

    await recoverMicrophone(asRoom(room), false)

    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'fresh-id', false)
  })

  it('restarts a dead track with the capture defaults re-asserted', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const track = fakeTrack()
    track.mediaStreamTrack.readyState = 'ended'
    const room = fakeRoom({ track })

    await recoverMicrophone(asRoom(room), false)

    // Passing the DSP flags is not decoration: restart() REPLACES the constraint
    // set, so a restart that names only the device drops echo cancellation for
    // the rest of the call.
    expect(track.restartTrack).toHaveBeenCalledWith({
      deviceId: 'builtin',
      ...AUDIO_CAPTURE_DEFAULTS,
    })
  })

  it('treats an OS-muted-but-live track as needing a fresh capture', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const track = fakeTrack()
    track.mediaStreamTrack.muted = true
    const room = fakeRoom({ track })

    await recoverMicrophone(asRoom(room), false)

    expect(track.restartTrack).toHaveBeenCalled()
  })

  it('un-pauses an upstream LiveKit nulled and never resumed', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const track = fakeTrack({ isUpstreamPaused: true })
    const room = fakeRoom({ track })

    await recoverMicrophone(asRoom(room), false)

    expect(track.resumeUpstream).toHaveBeenCalled()
    // A live track needs no re-capture — only the sender was detached.
    expect(track.restartTrack).not.toHaveBeenCalled()
  })

  it('leaves a healthy track completely alone', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const track = fakeTrack()
    const room = fakeRoom({ track })

    await recoverMicrophone(asRoom(room), false)

    expect(track.restartTrack).not.toHaveBeenCalled()
    expect(track.resumeUpstream).not.toHaveBeenCalled()
    // Constraint state has ONE owner (useNoiseFilter, on TrackEvent.Restarted).
    // Writing them here too would force the browser noise filter back on top of
    // Krisp, which deliberately wants it off.
    expect(track.mediaStreamTrack.applyConstraints).not.toHaveBeenCalled()
  })

  it('only unmutes when the caller says the mic was live', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const quiet = fakeRoom()
    await recoverMicrophone(asRoom(quiet), false)
    expect(quiet.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()

    resetMicRecovery()
    const loud = fakeRoom()
    await recoverMicrophone(asRoom(loud), true)
    expect(loud.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
  })

  it('reports no-device rather than pretending, when nothing is connected', async () => {
    devices()
    const room = fakeRoom()

    expect(await recoverMicrophone(asRoom(room), true)).toEqual({ ok: false, reason: 'no-device' })
    expect(room.switchActiveDevice).not.toHaveBeenCalled()
  })

  it('reports acquire-failed when the device is listed but will not open', async () => {
    devices(['builtin', 'MacBook Pro Microphone'])
    const track = fakeTrack()
    track.mediaStreamTrack.readyState = 'ended'
    track.restartTrack.mockRejectedValue(new Error('OverconstrainedError'))
    const room = fakeRoom({ track })

    expect(await recoverMicrophone(asRoom(room), true)).toEqual({
      ok: false,
      reason: 'acquire-failed',
    })
  })

  it('coalesces concurrent callers, and the stronger intent wins', async () => {
    // devicechange and the track's own `ended` event fire for ONE unplug. Two
    // getUserMedia calls racing over a single microphone is how you get a second
    // failure on top of the first.
    devices(['builtin', 'MacBook Pro Microphone'])
    const room = fakeRoom()

    const repointOnly = recoverMicrophone(asRoom(room), false)
    const wantsLive = recoverMicrophone(asRoom(room), true)
    await Promise.all([repointOnly, wantsLive])

    expect(room.switchActiveDevice).toHaveBeenCalledTimes(1)
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true)
  })

  it('repoints even with no publication, so the next enable is not doomed', async () => {
    // Mic off entirely: nothing to restart, but the room's pinned capture
    // default still has to be cleared or setMicrophoneEnabled(true) will ask for
    // the device that just left.
    devices(['builtin', 'MacBook Pro Microphone'])
    const room = fakeRoom({ track: undefined })

    expect(await recoverMicrophone(asRoom(room), false)).toEqual({
      ok: true,
      label: 'MacBook Pro Microphone',
    })
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'builtin', false)
  })
})

describe('trackNeedsRecovery / micUnusable', () => {
  it('flags dead, OS-muted and upstream-paused tracks', () => {
    const dead = fakeTrack()
    dead.mediaStreamTrack.readyState = 'ended'
    const osMuted = fakeTrack()
    osMuted.mediaStreamTrack.muted = true

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (x: FakeTrack) => trackNeedsRecovery(x as any)
    expect(t(dead)).toBe(true)
    expect(t(osMuted)).toBe(true)
    expect(t(fakeTrack({ isUpstreamPaused: true }))).toBe(true)
    // A user-muted track is perfectly healthy — LiveKit only flips `enabled`.
    expect(t(fakeTrack({ isMuted: true }))).toBe(false)
    expect(t(fakeTrack())).toBe(false)
  })

  it('counts a missing track as unusable — the pin still needs clearing', () => {
    expect(micUnusable(asRoom(fakeRoom({ track: undefined })))).toBe(true)
    expect(micUnusable(asRoom(fakeRoom()))).toBe(false)
  })
})
