import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { Island, Button, Avatar } from '@/components/primitives'
import { admit, listPending, type PendingKnocker } from '@/lib/orchestrator'
import { useAppStore } from '@/store/useAppStore'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'

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
  const [pending, setPending] = useState<PendingKnocker[]>([])

  // Say who's arrived, once each: the banner alone is silent to a host using a
  // screen reader, who would have to go looking for it.
  const announce = useAnnounce()
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const p of pending) {
      if (announced.current.has(p.id)) continue
      announced.current.add(p.id)
      announce(`${p.name} is waiting to join`)
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
      const list = await listPending(room.name, token!)
      if (stop) return
      // Metadata also changes for things other than the queue (flags, co-hosts). A
      // fresh array would re-render the banner (and its avatars) for nothing, so
      // keep the previous one unless who's waiting actually changed.
      setPending((prev) =>
        prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.name === list[i].name)
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
  }, [active, room, token])

  const decide = useCallback(
    (id: string, approve: boolean) => {
      if (!token) return
      setPending((prev) => prev.filter((p) => p.id !== id))
      void admit(room.name, token, id, approve).catch(() => {})
    },
    [room.name, token],
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
            <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            {/* Default (40px) size: admitting/denying a person is consequential
                enough to deserve a full touch target, not the compact sm. */}
            <Button variant="accent" aria-label={`Admit ${p.name}`} onClick={() => decide(p.id, true)}>
              Admit
            </Button>
            <Button variant="ghost" aria-label={`Deny ${p.name}`} onClick={() => decide(p.id, false)}>
              Deny
            </Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}
