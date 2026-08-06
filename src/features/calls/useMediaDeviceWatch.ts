import { useEffect } from 'react'
import { useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { RoomEvent, Track, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { addBreadcrumb, reportError } from '@/lib/report'
import { useScreenShare } from '@/features/calls/useScreenShare'

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
 * navigator `devicechange` signal. On a loss we announce it assertively (so a
 * non-sighted user hears it immediately), surface an actionable toast with a
 * one-tap re-acquire, and report it so the failure rate is measurable.
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

  useEffect(() => {
    if (!micMst) return
    const onEnded = () => {
      addBreadcrumb('local microphone track ended')
      reportError(new Error('microphone track ended unexpectedly'), { context: 'device-loss' })
      announce('Your microphone disconnected', 'assertive')
      toast('Your microphone disconnected', 'danger', {
        duration: 8000,
        action: { label: 'Reconnect', onClick: () => void localParticipant.setMicrophoneEnabled(true) },
      })
    }
    micMst.addEventListener('ended', onEnded)
    return () => micMst.removeEventListener('ended', onEnded)
  }, [micMst, localParticipant, announce])

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
