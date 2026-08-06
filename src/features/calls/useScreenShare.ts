import { useCallback } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import type { ScreenShareCaptureOptions } from 'livekit-client'
import { toast } from '@/store/useToastStore'
import { addBreadcrumb, reportError } from '@/lib/report'

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

/**
 * Capture options applied to every share.
 *
 * Deliberately empty for now — this hook ships as a pure extraction so the diff
 * that changes *behaviour* is separate from the diff that changes *structure*.
 * Surface hints and the focus controller land here next, in one place, where the
 * review can see every user-visible change at once.
 */
const CAPTURE_OPTIONS: ScreenShareCaptureOptions = {}

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
          await localParticipant.setScreenShareEnabled(on, on ? CAPTURE_OPTIONS : undefined)
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
