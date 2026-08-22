/*
  Decision logic for recovering a camera whose capture the OS interrupted.

  Pure and React-free so the guard matrix is unit-testable — the guards are the
  whole point of this feature. Getting one wrong means either a camera that never
  comes back (too strict) or a getUserMedia storm on every tab switch (too loose).
  The React/LiveKit glue lives in useCameraInterruption.ts.
*/

/** The bits of a MediaStreamTrack the decision depends on. */
export interface CaptureState {
  readyState: 'live' | 'ended' | string
  /** Set by the UA — NOT by us. `true` means frames stopped arriving. */
  muted: boolean
}

/**
 * Has the capture behind a published camera track stopped producing frames?
 *
 * Two distinguishable failure shapes, one verdict:
 *  - `ended` — the track is dead (device gone, or WebKit tore the capture down).
 *  - `muted` — the track is alive but the UA has stopped feeding it. This is the
 *    iOS background case, and per the WebRTC spec `muted` is UA-controlled: there
 *    is NO API to unmute it. Waiting is not a strategy; the frames only come back
 *    if the UA decides to send them, and after a background interruption it often
 *    doesn't. Re-acquiring is the only lever we have.
 *
 * An absent track is not a failure — the camera is simply off (or held warm by
 * useCameraToggle, which unpublishes without stopping).
 */
export function isCaptureInterrupted(capture: CaptureState | null | undefined): boolean {
  if (!capture) return false
  return capture.readyState === 'ended' || capture.muted === true
}

export interface RecoveryInputs {
  /** Does the user WANT the camera on? (a published, unmuted camera publication) */
  cameraEnabled: boolean
  /** Is the page in the foreground? getUserMedia cannot succeed on iOS while hidden. */
  pageVisible: boolean
  /** Is a recovery attempt already in flight? */
  busy: boolean
  /** Capture state of the published camera track, if there is one. */
  capture: CaptureState | null | undefined
}

/**
 * Should we re-acquire the camera right now?
 *
 * Every clause is load-bearing:
 *  - `cameraEnabled` — a deliberately-off camera must never be turned back on.
 *    This is the difference between a fix and a privacy bug.
 *  - `pageVisible` — iOS denies capture to a backgrounded page, so attempting
 *    while hidden burns a failed getUserMedia and, worse, can leave the track in
 *    a state the foreground attempt then has to clean up. We wait for the return.
 *  - `busy` — restartTrack is async and a real return-to-foreground fires
 *    `visibilitychange` AND `pageshow`. Without this, one interruption launches
 *    two concurrent re-acquires of the same device.
 *  - `isCaptureInterrupted` — the whole thing is a no-op on a healthy track, which
 *    is why this can run on every platform instead of sniffing for iOS. A desktop
 *    tab switch doesn't interrupt capture, so nothing fires.
 */
export function shouldRecoverCamera(i: RecoveryInputs): boolean {
  return i.cameraEnabled && i.pageVisible && !i.busy && isCaptureInterrupted(i.capture)
}
