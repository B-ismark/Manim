import { useCallback, useEffect } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, type LocalVideoTrack, type ScreenShareCaptureOptions } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { addBreadcrumb, reportError } from '@/lib/report'
import { useRoomStore } from '@/store/useRoomStore'

type ShareSurface = 'monitor' | 'window' | 'browser' | 'unknown'

/**
 * The ONE place a screen share starts and stops.
 *
 * Four call sites used to invoke `localParticipant.setScreenShareEnabled(...)`
 * directly — the desktop control bar, the mobile More sheet, the mini player, and
 * the "Share again" action on the share-ended toast. Every capture option we add
 * (surface hints, the focus controller, the display-surface read) would have had to
 * be repeated in all four, and the toast is the one that gets missed: it's the
 * RECOVERY path, so a share restarted after an accidental stop would silently come
 * back configured differently from every other share in the app.
 *
 * Capture options live in CAPTURE_OPTIONS below and nowhere else.
 *
 * Also fixes a smaller thing the extraction makes obvious: two of those four call
 * sites neither awaited nor caught the promise. Dismissing the browser's picker
 * rejects with NotAllowedError, so simply changing your mind about sharing produced
 * an unhandled rejection. Cancelling is a normal outcome and is now silent; a real
 * failure gets a toast instead of vanishing into the console.
 */

/** Chrome's Conditional Focus controller. Typed locally because `lib.dom` doesn't
 *  ship it yet, and LiveKit accepts it as `controller?: unknown`. */
interface FocusController {
  setFocusBehavior(behavior: 'focus-capturing-application' | 'no-focus-change'): void
}
declare const CaptureController: (new () => FocusController) | undefined

/**
 * Build the capture options for one share.
 *
 * ── Conditional Focus ──
 * Chrome's default for a window or tab capture is `focus-captured-surface`: it
 * raises the thing you just picked. The presenter therefore lands *in the shared
 * window* rather than in the call, so the presentation layout — and the Annotate
 * button sitting on the share tile — are behind another window at the exact moment
 * they would be used.
 *
 * `setFocusBehavior` is called BEFORE `getDisplayMedia`, which is the documented
 * Chrome pattern and the only one that works here: calling it after the promise
 * resolves throws `InvalidStateError` for a monitor capture (verified against
 * Chromium 141), and LiveKit awaits internally so we could not hit that window
 * anyway. Calling it first means we can hand the controller straight to LiveKit
 * instead of taking over the capture ourselves.
 *
 * ── Surface hints ──
 * `selfBrowserSurface: 'exclude'` drops our own tab from the picker: sharing the
 * call back into the call is never what someone means to do, and it is the sharpest
 * form of the mirror this whole change is about.
 * `surfaceSwitching: 'include'` lets a presenter change what they're sharing without
 * stopping and restarting — which also means the surface type can change mid-share,
 * so the read below is wired to `configurationchange`, not done once.
 */
function captureOptions(): ScreenShareCaptureOptions {
  const options: ScreenShareCaptureOptions = {
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  }
  try {
    if (typeof CaptureController === 'function') {
      const controller = new CaptureController()
      controller.setFocusBehavior('no-focus-change')
      options.controller = controller
    }
  } catch {
    // Unsupported, or the browser refused the behaviour. Sharing still works; the
    // presenter just gets the default focus jump.
  }
  return options
}

/** What kind of surface a published share is capturing. `undefined` from the
 *  browser (Firefox, synthetic captures) becomes 'unknown', which callers treat
 *  as permissive — see the store field's header. */
function readSurface(track: MediaStreamTrack | undefined): ShareSurface {
  const raw = track?.getSettings().displaySurface
  return raw === 'monitor' || raw === 'window' || raw === 'browser' ? raw : 'unknown'
}

/** Cancelling the picker — a normal outcome, not a failure worth reporting. */
function isUserCancel(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'NotAllowedError' || name === 'AbortError'
}

export interface ScreenShareControl {
  /** A local screen share is currently published. */
  enabled: boolean
  /** `getDisplayMedia` exists here — false on iOS Safari (and iOS Chrome, which is
   *  WebKit underneath), where the control should be hidden rather than offered. */
  supported: boolean
  start: () => void
  stop: () => void
  toggle: () => void
}

export function useScreenShare(): ScreenShareControl {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant()

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)

  const set = useCallback(
    (on: boolean) => {
      void (async () => {
        try {
          await localParticipant.setScreenShareEnabled(on, on ? captureOptions() : undefined)
        } catch (err) {
          if (isUserCancel(err)) {
            addBreadcrumb('screen share picker dismissed')
            return
          }
          reportError(err, { context: 'screen-share' })
          toast(on ? "Couldn't start sharing your screen" : "Couldn't stop sharing", 'danger')
        }
      })()
    },
    [localParticipant],
  )

  const start = useCallback(() => set(true), [set])
  const stop = useCallback(() => set(false), [set])
  const toggle = useCallback(() => set(!isScreenShareEnabled), [set, isScreenShareEnabled])

  return { enabled: isScreenShareEnabled, supported, start, stop, toggle }
}

/**
 * Keep `shareSurface` in the room store matching what's actually being captured.
 *
 * Mount ONCE, next to useMediaDeviceWatch — deliberately not folded into
 * useScreenShare(), which several components call, and which would then attach the
 * same listeners three times over.
 *
 * The read is repeated, not done once at publish time: `surfaceSwitching` lets a
 * presenter change what they're sharing mid-call without restarting, and
 * window → whole-monitor is exactly the transition that would otherwise leave the
 * stage echoing a monitor it still believed was a window.
 *
 * Two signals, because one of them isn't guaranteed. `configurationchange` is the
 * spec'd event for a surface swap, but Chromium 141 exposes no `onconfigurationchange`
 * IDL attribute on MediaStreamTrack, so we can't confirm it fires here — and a
 * silent miss would be invisible until someone hit the mirror. `resize` is
 * dependable and a surface swap essentially always changes dimensions, so it's the
 * backstop that makes a miss unlikely rather than merely improbable.
 */
export function useShareSurfaceWatch(): void {
  const { localParticipant } = useLocalParticipant()
  const setShareSurface = useRoomStore((s) => s.setShareSurface)

  const shareMst = (
    localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track as
      | LocalVideoTrack
      | undefined
  )?.mediaStreamTrack

  useEffect(() => {
    if (!shareMst) {
      setShareSurface('unknown')
      return
    }
    const read = () => {
      const surface = readSurface(shareMst)
      addBreadcrumb('screen share surface', { surface })
      setShareSurface(surface)
    }
    read()
    shareMst.addEventListener('configurationchange', read)
    shareMst.addEventListener('resize', read)
    return () => {
      shareMst.removeEventListener('configurationchange', read)
      shareMst.removeEventListener('resize', read)
    }
  }, [shareMst, setShareSurface])
}
