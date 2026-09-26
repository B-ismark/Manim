/**
 * Plain-language wording for a camera/mic that wouldn't start, keyed off the
 * DOMException name getUserMedia rejects with (LiveKit rethrows it unchanged).
 *
 * Two jobs. Wording: one generic "permission denied or unavailable" sent people
 * hunting through site settings when the real cause was Zoom holding the camera.
 * Classification: `LiveKitRoom` reports a failed initial publish through the SAME
 * onError as a failed connection, and treating both as fatal threw anyone with a
 * busy or missing camera back to prejoin — forever, since the toggle stayed on. A
 * device failure is not a connection failure: the call carries on without it.
 *
 * Pure and LiveKit-free on purpose — prejoin uses it, and prejoin's chunk must
 * not pull livekit-client in.
 */
export type MediaKind = 'camera' | 'microphone' | 'camera or microphone'

export function mediaErrorMessage(err: unknown, kind: MediaKind = 'camera or microphone'): string | null {
  const name = (err as { name?: unknown } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `Access to your ${kind} is blocked. Allow it from the icon in your browser’s address bar.`
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return `No ${kind} found. Plug one in, or carry on without it.`
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return `Your ${kind} is in use by another app. Close it there, then try again.`
    case 'DeviceUnsupportedError':
      return `This browser can’t use your ${kind} here.`
    default:
      return null
  }
}
