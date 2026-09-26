import { toast } from '@/store/useToastStore'
import { mediaErrorMessage } from '@/lib/mediaErrors'

/**
 * Turning a camera or mic back ON in the call can fail the same ways it can at
 * prejoin (another app took it, permission revoked, unplugged), and a muted track
 * re-acquires through `unmute()` → `restart()`, which never raises LiveKit's
 * `MediaDevicesError`. Nothing listened, so the button just stayed off with no
 * word and an unhandled rejection. Every toggle routes its promise through here.
 * A failure turning something OFF is not news worth a toast.
 */
/** Errors LiveKit already announced through `MediaDevicesError` (a fresh acquire
 *  emits the event AND rethrows the same error), so the toggle doesn't say it twice. */
const told = new WeakSet<object>()
export function markDeviceErrorTold(err: unknown): void {
  if (err && typeof err === 'object') told.add(err)
}

export function toggleDevice(kind: 'camera' | 'microphone', turningOn: boolean, run: () => Promise<unknown>): void {
  run().catch((err: unknown) => {
    if (!turningOn) return
    if (err && typeof err === 'object' && told.has(err)) return
    toast(mediaErrorMessage(err, kind) ?? `Your ${kind} couldn’t start. Try again.`, 'danger')
  })
}
