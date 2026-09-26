/**
 * The device id this browser uses inside ONE call.
 *
 * An identity is `name#device`, and everyone in a call sees every identity. With
 * the browser's persistent id in there, anyone in two calls with you could tell
 * it was the same browser both times, even under different names. Hashing it with
 * the room keeps what the server needs (stable for this browser in this room, so
 * seats, rejoining, removal and handoff all still work) and drops the link between
 * rooms. Not a secret: it only has to differ per room and not reveal the original.
 */
export async function roomDeviceId(deviceId: string, room: string): Promise<string> {
  const data = new TextEncoder().encode(`manim-room-device:${room}:${deviceId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
