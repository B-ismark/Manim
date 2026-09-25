/**
 * What this browser remembers about a PERSON, as opposed to about the device.
 *
 * Signing out used to clear the session and nothing else, so on a shared computer
 * the next person inherited your recent rooms — each carrying its join secret and
 * E2EE key — your saved room links and seat keys, your name, and a push
 * subscription that kept ringing this browser for your account. Sign-out and
 * account deletion now forget all of it.
 *
 * The device id and guest id go too: they're the stable half of every identity
 * this browser has shown in a call, so keeping them would let the next person's
 * guest sessions be linked to yours. Plain device preferences (theme, effects,
 * chosen mic/camera, coach marks) stay — they describe the machine, not you.
 */
export const PERSONAL_KEYS = [
  'mn.recentRooms',
  'mn.roomKeys',
  'mn.seats',
  'manim-profile-uid',
  'manim-display-name',
  'manim-notify-calls',
  'manim-device-id',
  'manim-guest-id',
] as const

export function forgetPersonalData(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  for (const k of PERSONAL_KEYS) {
    try {
      storage.removeItem(k)
    } catch {
      /* storage blocked — nothing was persisted there either */
    }
  }
}
