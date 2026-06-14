import { type RoomOptions, VideoPresets } from 'livekit-client'

/**
 * Room options tuned for our goals: simulcast + adaptive stream + dynacast keep
 * bandwidth/CPU low (lightweight goal). Low-bandwidth mode caps resolution and
 * (optionally) disables video entirely at the UI layer.
 */
export function roomOptions(lowBandwidth: boolean): RoomOptions {
  return {
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
  }
}
