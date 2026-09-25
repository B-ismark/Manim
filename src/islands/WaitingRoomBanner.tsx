import { useCallback, useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { Island, Button, Avatar } from '@/components/primitives'
import { admit, listPending, type PendingKnocker } from '@/lib/orchestrator'
import { useAppStore } from '@/store/useAppStore'

/**
 * Host-only: shows people knocking when the waiting room is on, with Admit/Deny.
 * Polls the orchestrator (dev server keeps the queue in memory).
 */
export function WaitingRoomBanner({ active }: { active: boolean }) {
  const room = useRoomContext()
  const token = useAppStore((s) => s.roomToken)
  const [pending, setPending] = useState<PendingKnocker[]>([])

  useEffect(() => {
    if (!active || !token) {
      setPending([])
      return
    }
    let stop = false
    async function poll() {
      // A background tab can't admit anyone, so don't spend a request every 3s on
      // it; the visibilitychange below catches up the moment the host looks back.
      if (document.hidden) return
      const list = await listPending(room.name, token!)
      if (stop) return
      // The poll almost always returns the queue it returned last time. A fresh
      // array would re-render the banner (and its avatars) every 3s for nothing,
      // so keep the previous one unless who's waiting actually changed.
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
    const id = window.setInterval(poll, 3000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, room.name, token])

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
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            {/* Default (40px) size: admitting/denying a person is consequential
                enough to deserve a full touch target, not the compact sm. */}
            <Button variant="accent" onClick={() => decide(p.id, true)}>
              Admit
            </Button>
            <Button variant="ghost" onClick={() => decide(p.id, false)}>
              Deny
            </Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}
