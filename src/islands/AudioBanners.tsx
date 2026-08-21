import { useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { Button, Island, Popover } from '@/components/primitives'
import { DeviceRow } from '@/islands/DeviceMenu'
import { recoverMicrophone } from '@/lib/audioRecovery'
import { setMicFault, useAudioStore, type MicFault } from '@/store/useAudioStore'
import { useIsTouch } from '@/lib/useIsTouch'

/**
 * The two things that can go wrong with call audio and still be fixed from the
 * screen. Both are children of TopStack (see its layer scale) — they render their
 * own pill and nothing else, and both sit ABOVE ConnectionBanner in that column:
 * audio that isn't working outranks a reconnect that's already in hand.
 *
 * Neither carries a live region of its own: the shared announcer already speaks
 * both faults (useMediaDeviceWatch and useAudioSession), and a role="status" here
 * on top of that made a screen reader say it twice. Same reason every other
 * banner in TopStack is a plain Island.
 *
 * Both are mode indicators, not notices, so neither has a dismiss. They go away
 * when the thing they describe is over. That's the whole point — the faults these
 * replace were announced by an eight-second toast, which expired long before the
 * fault did and left a dead microphone behind a perfectly ordinary-looking
 * control bar.
 */

const FAULT_DETAIL: Record<MicFault['reason'], (lost: string) => string> = {
  'no-device': (lost) => `${lost} disconnected. No other mic responded.`,
  blocked: () => 'Microphone access is blocked in your browser settings.',
  'acquire-failed': (lost) => `${lost} disconnected and wouldn't reconnect.`,
}

/**
 * A microphone we could not get back.
 *
 * Only shown when the user was actually transmitting when it broke — a headset
 * switched off while already muted gets the badge on the mic button and nothing
 * more, because there's nothing to interrupt. Recovery that SUCCEEDS never lands
 * here at all; it announces the new device and moves on.
 */
export function MicUnavailableBanner() {
  const fault = useAudioStore((s) => s.micFault)
  const room = useRoomContext()
  const [retrying, setRetrying] = useState(false)

  if (!fault || !fault.wasLive) return null

  const retry = () => {
    setRetrying(true)
    // The store clears itself the moment the mic is live again (the device watch
    // sees the new track), so success needs no bookkeeping here. A retry that
    // fails DIFFERENTLY does though — the detail line names the reason, and a
    // stale one would send the user after the wrong fix.
    void recoverMicrophone(room, true)
      .then((r) => {
        if (!r.ok && r.reason !== fault.reason) setMicFault({ ...fault, reason: r.reason })
      })
      .finally(() => setRetrying(false))
  }

  return (
    <Island
      elevation="raised"
      pad="sm"
      bordered
      className="pointer-events-auto flex max-w-[min(30rem,92vw)] items-center gap-3"
    >
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      <p className="min-w-0 text-sm text-ink">
        Microphone unavailable
        <span className="block text-xs text-ink-subtle">{FAULT_DETAIL[fault.reason](fault.lost)}</span>
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="accent" onClick={retry} disabled={retrying}>
          {retrying ? 'Trying…' : 'Try again'}
        </Button>
        {/* Pointless when permission is the problem — a different device is
            blocked just the same. */}
        {fault.reason !== 'blocked' && (
          <Popover
            side="bottom"
            align="end"
            trigger={
              <Button size="sm" variant="ghost">
                Choose mic
              </Button>
            }
          >
            <div className="w-64 max-w-[80vw]">
              <DeviceRow kind="audioinput" label="Microphone" />
            </div>
          </Popover>
        )}
      </div>
    </Island>
  )
}

/**
 * Playback the browser has revoked — the mobile app-switch case.
 *
 * `useAudioSession` silently resumes everything it can on the way back from
 * another app, and on Android that is normally the end of it. iOS routinely
 * refuses to play until it sees a fresh touch, and no amount of plumbing
 * satisfies that, so this asks for one. On touch it's a full-width tap target
 * rather than a button beside a message: collecting the gesture IS its job, so
 * the whole banner should take it.
 */
export function AudioBlockedBanner({
  canPlayback,
  onResume,
}: {
  canPlayback: boolean
  onResume: () => void
}) {
  const touch = useIsTouch()
  if (canPlayback) return null

  return (
    <Island
      elevation="raised"
      pad="sm"
      bordered
      className={
        touch
          ? 'pointer-events-auto flex w-full max-w-[min(30rem,92vw)] flex-col gap-2'
          : 'pointer-events-auto flex max-w-[min(30rem,92vw)] items-center gap-3'
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden />
        <p className="min-w-0 text-sm text-ink">
          Sound is off
          <span className="block text-xs text-ink-subtle">
            Your browser paused call audio while you were away.
          </span>
        </p>
      </div>
      <Button
        size="sm"
        variant="accent"
        block={touch}
        className="shrink-0"
        onClick={onResume}
      >
        Turn sound back on
      </Button>
    </Island>
  )
}
