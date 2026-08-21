import { useCallback, useEffect, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { addBreadcrumb, reportError } from '@/lib/report'
import { isCaptureInterrupted, shouldRecoverCamera } from '@/features/calls/cameraInterruption'

/**
 * Recover a camera the OS interrupted while the app was in the background.
 *
 * The reported symptom: minimise Safari mid-call on an iPhone, come back, and
 * your own video is off — for you and for everyone else. Nothing in the UI says
 * so, because from the app's point of view nothing happened: the publication is
 * still there, still unmuted, the tile still shows its last frame. The camera
 * button says the camera is ON. It isn't.
 *
 * What actually happens is that WebKit suspends capture for a backgrounded page
 * and marks the MediaStreamTrack `muted` (sometimes `ended` outright, e.g. when
 * another app claimed the camera in the meantime). `muted` is UA-controlled —
 * the spec gives the page no way to clear it — so there is nothing to wait for
 * and nothing to toggle. The track has to be re-acquired.
 *
 * Which is what this does, on return to the foreground:
 *   1. Let the UA have first refusal (SETTLE_MS). Modern WebKit sometimes
 *      unmutes on its own, and a restart we didn't need is a visible black
 *      flash plus a pointless getUserMedia.
 *   2. If the capture is still interrupted, `restartTrack()` — LiveKit
 *      re-acquires with the track's existing constraints (so a flipped
 *      facingMode / a chosen deviceId survives) and swaps the new track into
 *      the live sender. Remotes keep the same publication; no renegotiation
 *      churn, no "camera off" blip on their side.
 *   3. Retry a couple of times with backoff — a camera another app is still
 *      releasing is briefly unavailable, and the first attempt lands in that gap.
 *   4. If it still won't come back, SAY SO. A silent dead camera is the actual
 *      bug being fixed here; replacing it with a silent dead camera that we also
 *      know about would be a worse outcome. The toast carries a manual retry.
 *
 * Deliberately NOT gated on iOS. The guards in `shouldRecoverCamera` make this a
 * no-op wherever capture survives backgrounding (every desktop browser), so a
 * capability check does the same job as a UA sniff without the sniff — matching
 * lib/device.ts's rule. It also means Android's rarer version of the same
 * interruption is covered for free.
 *
 * Mount once inside the LiveKitRoom provider (RoomView), alongside
 * useMediaDeviceWatch — that one reports a camera that DIED, this one revives a
 * camera that was merely suspended. They don't overlap: `ended` on a background
 * interruption arrives while the page is hidden, where the toast would be unseen
 * and the "Reconnect" action unusable.
 */

/** Grace period for the UA to unmute on its own before we re-acquire. */
const SETTLE_MS = 700
/** Backoff for re-acquire attempts — a camera another app is releasing needs a moment. */
const RETRY_DELAYS_MS = [0, 900, 2200]

export function useCameraInterruption() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant()
  const announce = useAnnounce()
  // One recovery at a time. A real return-to-foreground on iOS fires
  // `visibilitychange` and `pageshow` back to back, and two concurrent
  // getUserMedia calls for one device is exactly how you get a second track that
  // mutes the first (the WebKit behaviour that has no programmatic undo).
  const busy = useRef(false)
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  const recover = useCallback(async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const track = pub?.track as LocalVideoTrack | undefined
    if (!track) return

    busy.current = true
    addBreadcrumb('camera capture interrupted — re-acquiring', {
      readyState: track.mediaStreamTrack.readyState,
      muted: track.mediaStreamTrack.muted,
    })
    try {
      for (const delay of RETRY_DELAYS_MS) {
        if (delay) await new Promise((r) => window.setTimeout(r, delay))
        // Bail if the user turned the camera off (or left) while we were waiting —
        // re-acquiring then would turn their camera back on behind their back.
        const live = localParticipant.getTrackPublication(Track.Source.Camera)
        const liveTrack = live?.track as LocalVideoTrack | undefined
        if (!liveTrack || live?.isMuted) return
        if (!isCaptureInterrupted(liveTrack.mediaStreamTrack)) return // recovered
        try {
          await liveTrack.restartTrack()
        } catch (e) {
          addBreadcrumb('camera restart attempt failed', { error: String(e) })
          continue
        }
        if (!isCaptureInterrupted(liveTrack.mediaStreamTrack)) return // recovered
      }

      // Last resort: drop the publication and acquire a brand-new track. This is
      // more disruptive than restartTrack (remotes briefly see the camera go
      // away) which is why it isn't the first move — but a visible blip beats a
      // camera that stays dark.
      try {
        await localParticipant.setCameraEnabled(false)
        await localParticipant.setCameraEnabled(true)
        const after = localParticipant.getTrackPublication(Track.Source.Camera)
        const afterTrack = after?.track as LocalVideoTrack | undefined
        if (afterTrack && !isCaptureInterrupted(afterTrack.mediaStreamTrack)) return
      } catch (e) {
        addBreadcrumb('camera re-publish failed', { error: String(e) })
      }

      // Still dark. Report it (so the real-world rate is measurable) and tell the
      // user, with the one action that might still work — their own tap, which
      // carries a user gesture we don't have.
      reportError(new Error('camera did not recover after interruption'), {
        context: 'camera-interruption',
      })
      announce('Your camera didn’t come back after leaving the app', 'assertive')
      toast('Your camera didn’t restart when you came back', 'danger', {
        duration: 10_000,
        action: {
          label: 'Restart camera',
          onClick: () => {
            void (async () => {
              try {
                await localParticipant.setCameraEnabled(false)
                await localParticipant.setCameraEnabled(true)
              } catch {
                toast('Still no camera — check another app isn’t using it', 'warning')
              }
            })()
          },
        },
      })
    } finally {
      busy.current = false
    }
  }, [localParticipant, announce])

  useEffect(() => {
    // `visibilitychange` is the signal; `pageshow` covers a restore from the
    // back/forward cache, which iOS uses aggressively and which does NOT always
    // come with a visibility transition. Both funnel through the same guards, so
    // the duplicate firing on a normal return is harmless.
    const onForeground = () => {
      if (document.visibilityState !== 'visible') return
      clearTimers()
      const t = window.setTimeout(() => {
        const pub = localParticipant.getTrackPublication(Track.Source.Camera)
        const track = pub?.track as LocalVideoTrack | undefined
        if (
          shouldRecoverCamera({
            cameraEnabled: isCameraEnabled,
            pageVisible: document.visibilityState === 'visible',
            busy: busy.current,
            capture: track?.mediaStreamTrack,
          })
        ) {
          void recover()
        }
      }, SETTLE_MS)
      timers.current.push(t)
    }

    // Breadcrumb the interruption itself. It fires while hidden — too early to act
    // on, but it's the evidence that distinguishes "iOS suspended the capture" from
    // "the camera was unplugged" when someone reports a dark tile.
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const mst = (pub?.track as LocalVideoTrack | undefined)?.mediaStreamTrack
    const onMute = () => addBreadcrumb('local camera capture muted by the UA')

    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('pageshow', onForeground)
    mst?.addEventListener('mute', onMute)
    return () => {
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('pageshow', onForeground)
      mst?.removeEventListener('mute', onMute)
      clearTimers()
    }
  }, [localParticipant, isCameraEnabled, recover, clearTimers])
}
