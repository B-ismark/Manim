import { type RoomOptions, VideoPresets, ExternalE2EEKeyProvider } from 'livekit-client'
import E2EEWorker from 'livekit-client/e2ee-worker?worker'

/**
 * Room options tuned for our goals: simulcast + adaptive stream + dynacast keep
 * bandwidth/CPU low (lightweight goal). Low-bandwidth mode caps resolution and
 * (optionally) disables video entirely at the UI layer.
 *
 * When an E2EE passphrase is supplied, the room is configured for end-to-end
 * encryption (insertable streams via a worker). All participants must use the
 * same passphrase to decode each other. Enabling happens in-room (RoomView).
 */
export function roomOptions(lowBandwidth: boolean, e2eePassphrase?: string): RoomOptions {
  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: lowBandwidth
        ? [VideoPresets.h180, VideoPresets.h360]
        : [VideoPresets.h360, VideoPresets.h720],
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
