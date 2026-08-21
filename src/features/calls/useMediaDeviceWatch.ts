import { useEffect } from 'react'
import { useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track, TrackEvent, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { addBreadcrumb, reportError } from '@/lib/report'
import { useScreenShare } from '@/features/calls/useScreenShare'
import { recoverMicrophone } from '@/lib/audioRecovery'
import { setMicFault } from '@/store/useAudioStore'

/** What to announce for a mic we couldn't get back — each names a different fix. */
const FAULT_MESSAGE: Record<'no-device' | 'blocked' | 'acquire-failed', string> = {
  'no-device': 'Your microphone disconnected and no other microphone is available',
  blocked: 'Microphone access is blocked in your browser settings',
  'acquire-failed': "Your microphone disconnected and couldn't be reconnected",
}

/**
 * Mid-call device-loss watch.
 *
 * Pre-join handles permissions well, but nothing watched the device lifecycle
 * ONCE in the call: if a USB camera is unplugged, a Bluetooth mic drops, or the
 * OS revokes permission mid-call, the underlying MediaStreamTrack ends and the
 * participant's tile silently keeps showing its last frame — they have no idea
 * their camera/mic died.
 *
 * We listen for the track's `ended` event (fired only on EXTERNAL termination —
 * the camera toggle's own `track.stop()` does NOT dispatch it, so a normal
 * camera-off never false-fires), plus the room-level MediaDevicesError and the
 * navigator `devicechange` signal.
 *
 * A CAMERA loss can only be announced — the user has to plug something back in.
 * A MICROPHONE loss usually can be repaired, so we repair it first (see
 * lib/audioRecovery) and only announce a failure the user still has. Losses that
 * couldn't be repaired are reported, so the metric counts real failures rather
 * than every routine headset toggle.
 *
 * Mount once inside the LiveKitRoom provider (RoomView).
 */
export function useMediaDeviceWatch() {
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const announce = useAnnounce()
  // Re-sharing goes through the same entry point as every other share, so the
  // recovery path can't drift from the one the control bar uses.
  const { start: startShare } = useScreenShare()

  // The live MediaStreamTracks behind the published camera/mic, if any. While the
  // camera is in its warm-off window there's no publication, so these are
  // undefined and we simply have nothing to watch until it re-publishes.
  const camPub = localParticipant.getTrackPublication(Track.Source.Camera)
  const camMst = (camPub?.track as LocalVideoTrack | undefined)?.mediaStreamTrack
  const micPub = localParticipant.getTrackPublication(Track.Source.Microphone)
  const micMst = (micPub?.track as LocalAudioTrack | undefined)?.mediaStreamTrack
  const sharePub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
  const shareMst = (sharePub?.track as LocalVideoTrack | undefined)?.mediaStreamTrack

  useEffect(() => {
    if (!camMst) return
    const onEnded = () => {
      addBreadcrumb('local camera track ended')
      reportError(new Error('camera track ended unexpectedly'), { context: 'device-loss' })
      announce('Your camera disconnected', 'assertive')
      toast('Your camera disconnected', 'danger', {
        duration: 8000,
        action: { label: 'Reconnect', onClick: () => void localParticipant.setCameraEnabled(true) },
      })
    }
    camMst.addEventListener('ended', onEnded)
    return () => camMst.removeEventListener('ended', onEnded)
  }, [camMst, localParticipant, announce])

  /**
   * A microphone loss is the one device loss we can usually undo, so we try
   * before we complain.
   *
   * The old handler did neither: it announced the loss and offered a "Reconnect"
   * button wired straight to `setMicrophoneEnabled(true)` — the exact call that
   * had just failed, and would keep failing, because the room's capture default
   * was still pinned `{ exact: <the device you just switched off> }`. Eight
   * seconds later the toast expired and the mic was gone for the rest of the
   * call, behind a control bar still showing an ordinary unmute button.
   * See lib/audioRecovery for why the pin survives LiveKit's own rescue.
   */
  useEffect(() => {
    if (!micMst) return
    const onEnded = () => {
      // Read the user's own mic state BEFORE the failure cascades: LiveKit mutes
      // the publication when its rescue fails, and a moment later "the user
      // muted" and "the platform muted it for them" look identical. We must
      // never unmute someone who muted themselves.
      const wasLive = !(micPub?.isMuted ?? false)
      const lost = micMst.label || 'Your microphone'
      addBreadcrumb('local microphone track ended', { wasLive })
      void recoverMicrophone(room, wasLive).then((r) => {
        if (r.ok) {
          // Recovered — but say so either way. A silent switch to a different
          // microphone is still the user's voice coming out of somewhere else,
          // and they get to know which.
          setMicFault(null)
          announce(`Microphone switched to ${r.label}`, 'polite')
          toast(`Microphone switched to ${r.label}`, 'neutral')
          return
        }
        // Nothing to fall back to. Report this case only, so the metric measures
        // real failures rather than every routine headset toggle.
        reportError(new Error(`microphone unrecoverable after device loss: ${r.reason}`), {
          context: 'device-loss',
        })
        // Persist it: the banner and the mic-button badge both read this, and
        // both stay until the mic works again. A toast that expired while the
        // fault didn't is what made this read as unrecoverable.
        setMicFault({ lost, reason: r.reason, wasLive })
        announce(FAULT_MESSAGE[r.reason], 'assertive')
      })
    }
    micMst.addEventListener('ended', onEnded)
    return () => micMst.removeEventListener('ended', onEnded)
  }, [micMst, micPub, room, announce])

  /**
   * The mic is producing audio again — by our recovery, by the user's own retry,
   * by the headset coming back, or by LiveKit's rescue. Whatever the route, the
   * fault is over and nothing should keep claiming otherwise.
   *
   * Event-driven, deliberately, and NOT keyed on a re-render: a track restart
   * swaps the MediaStreamTrack in place and emits no participant event, so
   * `useLocalParticipant` may not re-render and a `micMst` captured in a render
   * closure can stay stale — which would leave the control bar stuck offering a
   * retry for a microphone that already works.
   */
  useEffect(() => {
    const track = micPub?.track as LocalAudioTrack | undefined
    if (!track) return
    const check = () => {
      const mst = track.mediaStreamTrack
      if (mst.readyState === 'live' && !mst.muted) setMicFault(null)
    }
    check()
    track.on(TrackEvent.Restarted, check)
    track.on(TrackEvent.Unmuted, check)
    return () => {
      track.off(TrackEvent.Restarted, check)
      track.off(TrackEvent.Unmuted, check)
    }
  }, [micPub])

  /**
   * A screen share can end WITHOUT the user touching our Stop button: they hit
   * Chrome's own "Stop sharing" bar, or — the case that actually bites — they
   * were sharing a single application WINDOW and that window got closed. The
   * capture ends, LiveKit unpublishes, and the tile vanishes for everyone.
   *
   * Camera and mic have been watched for this since the device-loss work; the
   * screen share never was, so that vanishing came with no explanation at all.
   * From the presenter's seat their screen simply stopped being shared, and the
   * likeliest moment to notice is when someone tells you they can't see it.
   *
   * Not `danger`: ending a share is usually deliberate. This states what happened
   * and offers the way back.
   */
  useEffect(() => {
    if (!shareMst) return
    const onEnded = () => {
      addBreadcrumb('local screen share track ended')
      announce('Screen sharing stopped', 'assertive')
      toast('Screen sharing stopped', 'neutral', {
        duration: 8000,
        action: {
          label: 'Share again',
          onClick: startShare,
        },
      })
    }
    shareMst.addEventListener('ended', onEnded)
    return () => shareMst.removeEventListener('ended', onEnded)
  }, [shareMst, startShare, announce])

  // The set of devices changed (unplug / plug). We can't tell WHICH from this
  // event alone — the `ended` handlers above carry the user-facing message — but
  // it's a useful breadcrumb for diagnosing a device-loss report.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    const onChange = () => addBreadcrumb('mediaDevices devicechange')
    md.addEventListener('devicechange', onChange)
    return () => md.removeEventListener('devicechange', onChange)
  }, [])

  // LiveKit's own device-acquisition errors (e.g. a re-acquire that fails because
  // the device is gone). Surface + report rather than letting it disappear.
  useEffect(() => {
    if (!room) return
    const onErr = (e: Error) => {
      reportError(e, { context: 'media-devices-error' })
      announce('A camera or microphone problem interrupted your devices', 'assertive')
      toast('A camera or microphone problem interrupted your devices', 'danger')
    }
    room.on(RoomEvent.MediaDevicesError, onErr)
    return () => {
      room.off(RoomEvent.MediaDevicesError, onErr)
    }
  }, [room, announce])
}
