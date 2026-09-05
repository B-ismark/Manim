import {
  type RoomOptions,
  ScreenSharePresets,
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
 * Capture: 720p for cameras, or 360p in low-bandwidth mode. We deliberately do NOT
 * push 1080p encode on a phone — sustained 1080p VP-encode thermally throttles the
 * SoC and drops frames (which reads as *worse* quality, plus banding). Screen shares
 * keep their own, higher capture caps below: their content is text, which needs the
 * source resolution a camera tile does not.
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
 *   Do NOT "optimise" phones onto VP9 without reproducing the discoloration first:
 *   that is the bug this pin exists for, and it is invisible to every gate here.
 *
 * A consequence worth stating plainly, because the two share paths are NOT alike:
 * `screenShareSimulcastLayers` only ever applies to the VP8 publishers. For an SVC
 * codec LiveKit forces `scalabilityMode: 'L1T3'` on a screen share ("vp9 svc with
 * screenshare cannot encode multiple spatial layers") and returns from the SVC
 * branch of `computeVideoEncodings` before it ever reads that option — so a desktop
 * VP9 share is ONE spatial layer, full resolution, however small it is drawn.
 * Rooms made by "New meeting" or a contact call carry an E2EE key, so they are VP8
 * and do get layers; an open, typed-name room does not.
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
  // VP9 SVC on mobile HW encoders is the discoloration/heat offender — pin phones
  // (and every E2EE room) to color-faithful VP8 simulcast.
  const useVp8 = e2ee || isMobile()
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
      ...(useVp8 ? {} : { backupCodec: { codec: 'vp8' as const } }),
      simulcast: true,
      videoSimulcastLayers: layers,
      // Share capture cap. The normal value is deliberately the SAME as
      // livekit-client's own publishDefaults (h1080fps15), pinned here so a
      // library bump can't silently change what a share looks like — it is
      // documentation, not a behaviour change. lowBandwidth is the real one:
      // shares used to ignore that mode entirely (it degrades cameras only), so
      // a user on a metered link paid full 1080p/15 for someone else's screen.
      // 5fps suits text; a share is static pixels between scrolls.
      screenShareEncoding: (lowBandwidth
        ? ScreenSharePresets.h720fps5
        : ScreenSharePresets.h1080fps15
      ).encoding,
      // VP8 publishers ONLY — an SVC codec never reads this (see the header: a
      // VP9 share is pinned to L1T3, one spatial layer). Where it does apply it
      // replaces LiveKit's single default lower layer (half resolution, same
      // fps) with a proper ladder, so adaptiveStream can hand a grid-sized tile
      // 360p instead of 540p and dynacast can stop what nobody subscribes to.
      //
      // The trade is real and unmeasured: the publisher encodes three layers
      // instead of two. It is the right shape for a stage that draws one big
      // share and the rest as thumbnails, but if share uplink is ever the
      // binding constraint, MEASURE before widening this ladder further.
      ...(useVp8
        ? {
            screenShareSimulcastLayers: lowBandwidth
              ? [ScreenSharePresets.h360fps3]
              : [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps15],
          }
        : {}),
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
