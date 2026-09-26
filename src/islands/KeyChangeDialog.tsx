import { Button, Dialog } from '@/components/primitives'
import { useKeyChangeStore, type KeyChangeKind } from '@/store/useKeyChangeStore'

/**
 * Asked before a ring is sealed to devices this browser hasn't trusted yet
 * (lib/devicePins). Closing it any way but Ring anyway means the ring doesn't go.
 *
 * The words stay calm on purpose. The usual cause is innocent (a new phone, or
 * they signed out and back in), and the useful thing to say is what to do if it
 * wasn't expected: ask them some other way.
 */
const COPY: Record<KeyChangeKind, (n: string) => { title: string; body: string }> = {
  added: (n) => ({
    title: `${n} has a new device`,
    body: `${n} signed in somewhere new since you last called, and your call will ring there too. If you weren’t expecting it, check with ${n} another way first.`,
  }),
  changed: (n) => ({
    title: `${n}’s security key changed`,
    body: `One of ${n}’s devices has a new key since you last called. That usually means they signed out and back in. If you weren’t expecting it, check with ${n} another way before you ring.`,
  }),
  unprotected: (n) => ({
    title: `Can’t protect this call for ${n}`,
    body: `None of ${n}’s devices came back to lock the call link to, so it would be sent unprotected. You can try again in a moment, or share the link another way.`,
  }),
}

export function KeyChangeDialog() {
  const pending = useKeyChangeStore((s) => s.pending)
  const answer = useKeyChangeStore((s) => s.answer)
  const copy = COPY[pending?.kind ?? 'changed'](pending?.name ?? '')
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && answer(false)} title={copy.title} description={copy.body}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="neutral" className="pointer-coarse:h-11" onClick={() => answer(false)}>
          Don’t ring
        </Button>
        <Button variant="accent" className="pointer-coarse:h-11" onClick={() => answer(true)}>
          Ring anyway
        </Button>
      </div>
    </Dialog>
  )
}
