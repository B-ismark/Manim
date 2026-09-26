import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Island } from '@/components/primitives'
import { CameraIcon, CloseIcon } from '@/components/icons'
import { useDevicePresence, useOtherDeviceMeetings } from '@/features/calls/usePresence'
import { useAppStore } from '@/store/useAppStore'
import { roomTo } from '@/lib/roomLink'
import { prettyRoom } from '@/lib/roomName'
import { useToastClearance } from '@/lib/toastClearance'

/**
 * "You're in a call on another device", wherever you are in the app.
 *
 * Mounted once (App), where it also holds the app's one connection to the
 * presence channel (useDevicePresence) — idle or in a call, so starting a call
 * never swaps the channel out from under itself.
 *
 * The home screen lists these calls in place ("On your other devices"), so the
 * banner stays off there. Everywhere else — a prejoin for some other room, the
 * end-of-call screen, the legal pages — it's the only way you'd find out. If the
 * tab is in the background when a call appears, a system notification says so
 * too, when notifications are already allowed (this never asks).
 */
export function OtherDeviceCallBanner() {
  const inCall = useAppStore((s) => s.roomToken !== null)
  useDevicePresence()
  const meetings = useOtherDeviceMeetings()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  // Tell a backgrounded tab once per room, the way a ring does.
  const told = useRef(new Set<string>())
  useEffect(() => {
    for (const m of meetings) {
      if (told.current.has(m.room)) continue
      told.current.add(m.room)
      if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') continue
      try {
        const n = new Notification('You’re in a call on another device', {
          body: `${prettyRoom(m.room)} · open Manim to join here`,
          tag: `mn-other-device-${m.room}`,
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
      } catch {
        /* notifications unavailable in this context */
      }
    }
  }, [meetings])

  const here = pathname.startsWith('/r/') ? decodeURIComponent(pathname.slice(3)) : null
  const shown =
    inCall || pathname === '/'
      ? undefined
      : meetings.find((m) => m.room !== here && !dismissed.has(m.room))
  const ref = useRef<HTMLDivElement>(null)
  useToastClearance(ref, Boolean(shown))
  if (!shown) return null

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-40 flex justify-center px-4"
    >
      <Island
        elevation="raised"
        pad="sm"
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-3"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-text [&_svg]:size-4">
          <CameraIcon />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{prettyRoom(shown.room)}</p>
          <p className="text-xs text-ink-muted">You’re in this call on another device</p>
        </div>
        <Button
          size="sm"
          variant="accent"
          onClick={() => navigate(roomTo(shown.room, { secret: shown.secret, e2ee: shown.e2ee }))}
        >
          Join here
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed((d) => new Set(d).add(shown.room))}
          className="grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-3.5"
        >
          <CloseIcon />
        </button>
      </Island>
    </div>
  )
}
