import { useCallback, useEffect, useRef } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { Island, Button, Avatar } from '@/components/primitives'
import { admit, listPending, type PendingKnocker } from '@/lib/orchestrator'
import { useAppStore } from '@/store/useAppStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useWaitingStore } from '@/store/useWaitingStore'

/**
 * Host-only: shows people knocking when the waiting room is on, with Admit/Deny.
 *
 * The queue lives (sealed) in the room's metadata, so every knock, admit and
 * deny changes the metadata and LiveKit pushes that change to everyone in the
 * call. The banner asks the server for the readable list only then — it used to
 * ask every 3s, for as long as the waiting room was on, from every host and
 * co-host. A slow fallback catches requests expiring on their own.
 */
const FALLBACK_MS = 60_000
export function WaitingRoomBanner({ active }: { active: boolean }) {
  const room = useRoomContext()
  const token = useAppStore((s) => s.roomToken)
  // Shared with People's Waiting section (store/useWaitingStore): this banner is
  // the one place that fetches it, so the two can't disagree or double the asks.
  const pending = useWaitingStore((s) => s.pending)
  const setPending = useWaitingStore((s) => s.set)
  const setDecide = useWaitingStore((s) => s.setDecide)
  // The queue of decisions in flight, and who is in it (see `decide`).
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const deciding = useRef(new Set<string>())

  // Say who's arrived, once each: the banner alone is silent to a host using a
  // screen reader, who would have to go looking for it.
  const announce = useAnnounce()
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const p of pending) {
      // Keyed by what's said, so a note left after the knock is read out too.
      const key = `${p.id}\n${p.name}\n${p.note ?? ''}`
      if (announced.current.has(key)) continue
      const first = !announced.current.has(p.id)
      announced.current.add(key)
      announced.current.add(p.id)
      if (first) announce(`${p.name} is waiting to join${p.note ? `: ${p.note}` : ''}`)
      else if (p.note) announce(`${p.name} left a note: ${p.note}`)
    }
  }, [pending, announce])

  useEffect(() => {
    if (!active || !token) {
      setPending([])
      return
    }
    let stop = false
    async function poll() {
      // A background tab can't admit anyone, so don't spend a request on it; the
      // visibilitychange below catches up the moment the host looks back.
      if (document.hidden) return
      const fetched = await listPending(room.name, token!)
      if (stop) return
      // Someone already decided on, whose request is still queued, isn't waiting
      // any more as far as the host is concerned — don't flash them back in.
      const list = fetched.filter((p) => !deciding.current.has(p.id))
      // Metadata also changes for things other than the queue (flags, co-hosts). A
      // fresh array would re-render the banner (and its avatars) for nothing, so
      // keep the previous one unless who's waiting actually changed.
      setPending((prev) =>
        prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.name === list[i].name && p.note === list[i].note)
          ? prev
          : list,
      )
    }
    const onVisible = () => {
      if (!document.hidden) void poll()
    }
    void poll()
    const id = window.setInterval(poll, FALLBACK_MS)
    const onMetadata = () => void poll()
    room.on(RoomEvent.RoomMetadataChanged, onMetadata)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      window.clearInterval(id)
      room.off(RoomEvent.RoomMetadataChanged, onMetadata)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, room, token, setPending])

  // Decisions go to the server ONE AT A TIME. Each admit is a read-modify-write
  // of the whole sealed queue in the room's metadata (server/core handleAdmit),
  // so two in flight together both read the same queue and the second write
  // undoes the first: the guest it "admitted" stays waiting. People's "Admit all"
  // sends a burst of these, and two quick Admit clicks here did the same.
  const decide = useCallback(
    (p: PendingKnocker, approve: boolean) => {
      if (!token) return
      deciding.current.add(p.id)
      setPending((prev) => prev.filter((q) => q.id !== p.id))
      chain.current = chain.current.then(() =>
        admit(room.name, token, p.id, approve, p.name)
          // A rename since the banner last looked is refused; show them again.
          .catch(() => {
            deciding.current.delete(p.id)
            return listPending(room.name, token).then(
              (list) => setPending(list.filter((q) => !deciding.current.has(q.id))),
              () => {},
            )
          })
          .finally(() => deciding.current.delete(p.id)),
      )
    },
    [room.name, token, setPending],
  )
  useEffect(() => {
    setDecide(decide)
  }, [decide, setDecide])
  // Leaving the call (or losing host) must not leave a stale queue for People.
  useEffect(
    () => () => {
      setPending([])
      setDecide(() => {})
    },
    [setPending, setDecide],
  )

  if (!active || pending.length === 0) return null

  // Positioned by TopStack — see the layer scale there.
  return (
    <Island elevation="raised" pad="sm" className="pointer-events-auto w-full max-w-sm">
      <p className="mb-2 text-xs font-medium text-ink-subtle">
        Waiting to join ({pending.length})
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5">
            <Avatar name={p.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-sm font-medium">{p.name}</span>
              {/* Their note from the waiting room: who they are, why they're here. */}
              {p.note && (
                <span dir="auto" className="block truncate text-xs text-ink-muted" title={p.note}>
                  “{p.note}”
                </span>
              )}
            </span>
            {/* Default (40px) size: admitting/denying a person is consequential
                enough to deserve a full touch target, not the compact sm. */}
            <Button variant="accent" aria-label={`Admit ${p.name}`} onClick={() => decide(p, true)}>
              Admit
            </Button>
            <Button variant="ghost" aria-label={`Deny ${p.name}`} onClick={() => decide(p, false)}>
              Deny
            </Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}
