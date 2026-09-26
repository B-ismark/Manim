import { useEffect, useRef, useState } from 'react'
import {
  useConnectionQualityIndicator,
  useConnectionState,
  useLocalParticipant,
} from '@livekit/components-react'
import { ConnectionQuality as Quality, ConnectionState } from 'livekit-client'
import { LockIcon, MicOffIcon } from '@/components/icons'
import { ConnectionQuality } from '@/islands/ConnectionQuality'
import { MUTED_PILL_H, useChromeHidden, useRail } from '@/lib/chromeBands'
import { cn } from '@/lib/cn'
import { returnGraceLeft } from '@/lib/foreground'

export interface CallStatusBarProps {
  /** True only when E2EE is ACTUALLY active (room.setE2EEEnabled resolved), not
   *  merely when a passphrase was typed — the badge must never overstate security. */
  encrypted: boolean
  /** Hidden alongside the rest of the chrome on mobile tap-to-hide. */
  visible: boolean
}

/** mm:ss, or h:mm:ss past an hour. */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** Live call duration since the local participant joined (ticks every second). */
function useCallTimer(): string {
  const { localParticipant } = useLocalParticipant()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // joinedAt reflects the true call start (survives reconnects); fall back to
  // first render before the roster settles.
  const startedAt = localParticipant.joinedAt?.getTime() ?? now
  return formatElapsed(Math.floor((now - startedAt) / 1000))
}

/** A degraded reading must hold this long before we say anything about it. */
const DEGRADED_HOLD_MS = 5000

/**
 * Is the connection in trouble, and is it actually LOST?
 *
 * Two separate questions, and conflating them is what put "Connection lost" over a
 * call that was working perfectly for forty minutes.
 *
 * `ConnectionQuality` is a per-subscriber BANDWIDTH heuristic the SFU publishes on
 * an interval. It reports `Lost` for reasons that are not "your call has dropped" —
 * a packet-loss spike, a participant with nothing published, an interval that
 * arrived late — and, because the value simply persists until the next update, a
 * single bad sample stays on screen indefinitely. The chip took that one sample and
 * announced the strongest possible claim about the whole call, instantly, with no
 * hold. Meanwhile the client's actual answer to "am I connected" — the one the
 * reconnect logic itself runs on, and the one the Reconnecting banner and the
 * screen-reader announcement both use — is `ConnectionState`, and it said Connected
 * the entire time.
 *
 * So: `ConnectionState` decides whether we may use the word "lost". Quality decides
 * whether to warn at all, and now has to hold {@link DEGRADED_HOLD_MS} before it
 * may — which it already had to for `Poor` (many regions, e.g. West Africa → the
 * Marseille edge at ~150ms RTT, sit at a latency LiveKit buckets as Poor and call
 * fine), and which `Lost` was exempted from precisely because it was assumed to be
 * definitive. A real drop still surfaces immediately, via the state, so nothing is
 * slower than it was — the hold only delays the readings that were wrong.
 *
 * Recovery clears the warning at once, in both directions.
 */
function useConnectionWarning(quality: Quality): { warn: boolean; lost: boolean } {
  const state = useConnectionState()
  // The authoritative "we are not connected right now" — this is what makes the
  // banner appear and the announcer speak, so the chip agreeing with it is also the
  // thing that stops three surfaces telling the user three different stories.
  const lost =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting
  const degraded = quality === Quality.Poor || quality === Quality.Lost
  const [held, setHeld] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const clear = () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current)
        timer.current = undefined
      }
    }
    if (!degraded) {
      clear()
      setHeld(false)
      return clear
    }
    // One hold per continuous degraded spell: Poor→Lost→Poor doesn't restart it,
    // because `degraded` never went false.
    if (!held && timer.current === undefined) {
      // Just back from another app: the first readings describe the time the
      // page was frozen, not the line (lib/foreground), so wait them out too.
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        setHeld(true)
      }, Math.max(DEGRADED_HOLD_MS, returnGraceLeft()))
    }
    return clear
  }, [degraded, held])

  return { warn: held || lost, lost }
}

/**
 * Persistent status chip, top-center (WhatsApp/Telegram convention): the call
 * timer always, plus an end-to-end-encryption badge and weak-connection warning
 * when relevant. Non-interactive; taps pass through to the stage gesture layer.
 */
export function CallStatusBar({ encrypted, visible }: CallStatusBarProps) {
  const { localParticipant } = useLocalParticipant()
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant })
  const { warn, lost } = useConnectionWarning(quality)
  const elapsed = useCallTimer()

  // Unmounted rather than translated away when the chrome hides. As a positioned
  // element it could slide off and leave nothing behind, but as a row in TopStack
  // an invisible pill still holds its slot — and its gap — so everything below it
  // would sit ~52px too low with an empty band above. Losing the slide-out is the
  // cheaper trade; `mn-pop` keeps the reveal from being abrupt.
  if (!visible) return null

  return (
    // Positioned by TopStack — see the layer scale there.
    <div className="mn-pop flex min-h-11 items-center gap-2 rounded-control bg-overlay px-3 text-xs font-medium text-white backdrop-blur">
      {encrypted && <LockIcon className="size-3.5" aria-label="End-to-end encrypted" />}
      <span role="timer" className="tabular-nums" aria-label="Call duration">
        {elapsed}
      </span>
      {warn && (
        <>
          <span className="h-3 w-px bg-white/30" aria-hidden />
          <span className="flex items-center gap-1.5">
            <ConnectionQuality participant={localParticipant} />
            {/* Label only where there's room — the bars carry the meaning on
                narrow phones (avoids the top pill overflowing). */}
            <span className="hidden min-[380px]:inline">
              {lost ? 'Connection lost' : 'Weak connection'}
            </span>
          </span>
        </>
      )}
    </div>
  )
}

/**
 * "Muted", while the touch chrome is hidden.
 *
 * The mic button is the one piece of state you must never lose track of in a call,
 * and it fades out with the rest of the island. So while the bars are gone, and only
 * if you're muted, this takes the timer's slot at the top: glanceable, red, and
 * gone again the moment the bars come back and the button itself says the same.
 * Taps pass through (a tap anywhere brings the controls back, which is how you'd
 * unmute).
 *
 * Sideways it moves to the bottom-left corner instead: at the top it landed among
 * the corner buttons of whichever tile was under it. It is still rendered from
 * TopStack (one home for status), just positioned out of the column, and it tells
 * the stage it's there so the tiles leave its strip clear (chromeBands).
 */
export function MutedPill({ chromeVisible }: { chromeVisible: boolean }) {
  const { isMicrophoneEnabled } = useLocalParticipant()
  const rail = useRail()
  const shown = !chromeVisible && !isMicrophoneEnabled
  const corner = shown && rail
  useEffect(() => {
    useChromeHidden.setState({ mutedCorner: corner })
    return () => useChromeHidden.setState({ mutedCorner: false })
  }, [corner])
  if (!shown) return null
  return (
    <div
      data-testid="muted-pill"
      className={cn(
        'mn-pop flex items-center gap-1.5 rounded-control bg-danger px-3 text-xs font-medium text-white shadow-sm',
        corner && 'fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))]',
      )}
      style={{ height: MUTED_PILL_H }}
    >
      <MicOffIcon className="size-3.5" aria-hidden />
      Muted
    </div>
  )
}
