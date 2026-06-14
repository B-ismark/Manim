import { useCallback, useEffect, useState } from 'react'
import { useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { Island, Button, Avatar } from '@/components/primitives'
import { admit, listPending, type PendingKnocker } from '@/lib/orchestrator'

/**
 * Host-only: shows people knocking when the waiting room is on, with Admit/Deny.
 * Polls the orchestrator (dev server keeps the queue in memory).
 */
export function WaitingRoomBanner({ active }: { active: boolean }) {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const [pending, setPending] = useState<PendingKnocker[]>([])

  useEffect(() => {
    if (!active) {
      setPending([])
      return
    }
    let stop = false
    async function poll() {
      const list = await listPending(room.name, localParticipant.identity)
      if (!stop) setPending(list)
    }
    void poll()
    const id = window.setInterval(poll, 3000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [active, room.name, localParticipant.identity])

  const decide = useCallback(
    (id: string, approve: boolean) => {
      setPending((prev) => prev.filter((p) => p.id !== id))
      void admit(room.name, localParticipant.identity, id, approve).catch(() => {})
    },
    [room.name, localParticipant.identity],
  )

  if (!active || pending.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-30 flex justify-center px-4">
      <Island elevation="raised" pad="sm" className="pointer-events-auto w-full max-w-sm">
        <p className="mb-2 text-xs font-medium text-ink-subtle">
          Waiting to join ({pending.length})
        </p>
        <ul className="space-y-2">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <Avatar name={p.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <Button size="sm" variant="accent" onClick={() => decide(p.id, true)}>
                Admit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide(p.id, false)}>
                Deny
              </Button>
            </li>
          ))}
        </ul>
      </Island>
    </div>
  )
}
