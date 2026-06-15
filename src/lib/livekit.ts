import { type RoomOptions, VideoPresets, ExternalE2EEKeyProvider } from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'

/**
 * Room options tuned for our goals: simulcast + adaptive stream + dynacast keep
 * bandwidth/CPU low (lightweight goal). Low-bandwidth mode caps resolution and
 * (optionally) disables video entirely at the UI layer.
 *
 * Codec: VP9 (with an automatic VP8 backup). VP9 carries ~30-50% less bitrate
 * than VP8 at the same perceptual quality; picking it makes LiveKit publish a
 * single SVC stream (it disables simulcast internally and layers via SVC).
 * `backupCodec` re-publishes VP8 for subscribers that can't decode VP9 (Safari,
 * older clients) — that costs extra upstream only while such a subscriber is
 * present. CPU cost of VP9 encode is higher than VP8; acceptable for our ≤20 size.
 *
 * E2EE guard: VP9 SVC + end-to-end encryption (insertable streams) is solid on
 * Chromium but flaky elsewhere, and a re-encoded backup codec complicates the
 * encrypted pipeline. When a passphrase is set we drop to plain VP8 + simulcast —
 * universally decodable, no SVC/backup edge cases — trading some bitrate for
 * reliable encrypted playback. E2EE rooms are the smaller-call case anyway.
 *
 * Audio: DTX drops to near-zero bitrate during silence (big win in group calls);
 * RED (kept on, LiveKit default) adds packet-loss resilience at a small cost.
 *
 * When an E2EE passphrase is supplied, the room is configured for end-to-end
 * encryption (insertable streams via a worker). All participants must use the
 * same passphrase to decode each other. Enabling happens in-room (RoomView).
 */
export function roomOptions(lowBandwidth: boolean, e2eePassphrase?: string): RoomOptions {
  const e2ee = Boolean(e2eePassphrase)
  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      // VP9/SVC normally; plain VP8 under E2EE (see guard note above).
      videoCodec: e2ee ? 'vp8' : 'vp9',
      // VP8 backup for non-VP9 clients (Safari). Omitted under E2EE — already VP8.
      ...(e2ee ? {} : { backupCodec: { codec: 'vp8' as const } }),
      // Active for the VP8 paths; ignored once VP9/SVC takes over.
      simulcast: true,
      videoSimulcastLayers: lowBandwidth
        ? [VideoPresets.h180, VideoPresets.h360]
        : [VideoPresets.h360, VideoPresets.h720],
      // Opus discontinuous transmission: near-silent frames cost ~nothing.
      dtx: true,
      // Redundant audio encoding for loss resilience (LiveKit-recommended default).
      red: true,
    },
    videoCaptureDefaults: {
      resolution: lowBandwidth ? VideoPresets.h360.resolution : VideoPresets.h720.resolution,
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
