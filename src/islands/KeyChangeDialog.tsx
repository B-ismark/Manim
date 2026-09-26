import { Button, Dialog } from '@/components/primitives'
import { useKeyChangeStore } from '@/store/useKeyChangeStore'

/**
 * "Ama's security key changed": asked before a ring is sealed to a device of
 * theirs whose key isn't the one this browser remembers (lib/devicePins).
 * Closing it any way but Ring anyway means the ring doesn't go.
 *
 * The words stay calm on purpose. The usual cause is innocent (they signed out
 * and back in, or cleared the browser), and the useful thing to say is what to
 * do if it wasn't expected: ask them some other way.
 */
export function KeyChangeDialog() {
  const pending = useKeyChangeStore((s) => s.pending)
  const answer = useKeyChangeStore((s) => s.answer)
  const name = pending?.name ?? ''
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(o) => !o && answer(false)}
      title={`${name}’s security key changed`}
      description={`One of ${name}’s devices has a new key since you last called. That usually means they signed out and back in. If you weren’t expecting it, check with ${name} another way before you ring.`}
    >
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
