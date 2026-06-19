import {
  type RoomOptions,
  VideoPresets,
  ExternalE2EEKeyProvider,
} from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'
import { isMobile } from '@/lib/device'

/**
 * Room options tuned for high perceptual quality with graceful degradation:
 * simulcast + adaptiveStream + dynacast let each subscriber pull only the layer it
 * needs, and on a weak UPLINK WebRTC simply stops sending the higher simulcast
 * layers (peers fall back to a lower one, and it climbs back automatically when
 * bandwidth returns) — all without ever restarting the capture. So the default is
 * "as sharp as the device can do", degrading on the wire rather than by re-acquiring
 * the camera. (An earlier capture-restart LOD blacked the preview on/off as quality
 * flapped Poor↔Good; simulcast covers the same need with no flicker.)
 *
 * Capture: 1080p on desktop, 720p on phones. We deliberately do NOT push 1080p
 * encode on a phone — sustained 1080p VP-encode thermally throttles the SoC and
 * drops frames (which reads as *worse* quality, plus banding), so 720p is the
 * real-world sweet spot for a portrait tile. Low-bandwidth mode drops this further.
 *
 * Codec:
 * - Desktop, no E2EE → VP9 + VP8 backup. VP9 carries ~30-50% less bitrate at the
 *   same quality; LiveKit publishes a single SVC stream and re-publishes VP8 only
 *   while a non-VP9 subscriber (Safari/old) is present.
 * - Phones / E2EE → plain VP8 + simulcast. VP9 *SVC* on mobile hardware encoders
 *   is the usual culprit behind the washed-out / tinted "discoloration" on calls
 *   (buggy HW color paths + starved SVC base layer), and it runs hot. VP8 is the
 *   universally hardware-accelerated, color-faithful path; it costs a little more
 *   bitrate, which the higher capture + LOD comfortably absorb. E2EE keeps VP8
 *   too (insertable streams + VP9 SVC/backup is flaky off-Chromium).
 *
 * degradationPreference 'maintain-resolution': when the encoder is constrained it
 * sheds frame RATE before resolution, keeping faces/text crisp rather than going
 * blocky+discolored — paired with simulcast layer-dropping for graceful uplink
 * degradation that never touches the capture.
 *
 * Audio: DTX → near-zero bitrate during silence; RED → packet-loss resilience.
 * When an E2EE passphrase is supplied the room enables end-to-end encryption
 * (insertable streams via a worker); all participants need the same passphrase.
 */
export function roomOptions(lowBandwidth: boolean, e2eePassphrase?: string): RoomOptions {
  const e2ee = Boolean(e2eePassphrase)
  const mobile = isMobile()
  // VP9 SVC on mobile HW encoders is the discoloration/heat offender — pin phones
  // (and every E2EE room) to color-faithful VP8 simulcast.
  const useVp8 = e2ee || mobile
  // Capture at 720p (not 1080p) even on desktop: requesting a 1080p getUserMedia
  // makes the camera visibly slow to start — both on join and on mid-call toggle —
  // as the sensor negotiates its high mode, for quality a video tile barely shows.
  // 720p starts fast and stays crisp; lowBandwidth forces the floor.
  const capturePreset = lowBandwidth ? VideoPresets.h360 : VideoPresets.h720
  const layers = lowBandwidth
    ? [VideoPresets.h180, VideoPresets.h360]
    : [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720]
  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      videoCodec: useVp8 ? 'vp8' : 'vp9',
      // VP8 backup only matters for the VP9 path; omit when already VP8.
      ...(useVp8 ? {} : { backupCodec: { codec: 'vp8' as const } }),
      simulcast: true,
      videoSimulcastLayers: layers,
      // Keep the picture sharp under load; drop fps before resolution.
      degradationPreference: 'maintain-resolution',
      // Opus discontinuous transmission: near-silent frames cost ~nothing.
      dtx: true,
      // Redundant audio encoding for loss resilience (LiveKit-recommended default).
      red: true,
    },
    videoCaptureDefaults: {
      resolution: capturePreset.resolution,
    },
    // Always-on baseline audio cleanup (browser WebRTC DSP). The opt-in Krisp
    // filter (useNoiseFilter) layers stronger AI suppression on top of this.
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }

  if (e2eePassphrase) {
    const keyProvider = new ExternalE2EEKeyProvider()
    void keyProvider.setKey(e2eePassphrase)
    options.e2ee = { keyProvider, worker: new E2EEWorker() }
  }

  return options
}
