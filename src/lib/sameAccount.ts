import { useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, type Participant, type Room } from 'livekit-client'

/**
 * Which other seats in this call are YOU, on another device?
 *
 * Checked, not assumed: participant metadata can be rewritten by its owner, so
 * a matching `userId` alone proves nothing. The server signs (room, identity,
 * userId) at mint (server/account.mjs); the public key is read from OUR OWN
 * metadata, which came from our own token. See that file for the whole argument.
 *
 * Seats are keyed by participant SID, never by identity. An identity is just a
 * name#device string that anyone can knock with once the device has left; a SID
 * is minted by the server for one connection and never reused. So a message
 * stays yours after its device leaves (its SID was verified), and a stranger who
 * later takes the same identity gets a fresh SID that fails the check.
 */

const CLAIM_V = 'acct1'

interface Meta {
  userId?: string
  ak?: string
  as?: string
}

function metaOf(p: Participant): Meta {
  try {
    return JSON.parse(p.metadata || '{}') as Meta
  } catch {
    return {}
  }
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

const keys = new Map<string, Promise<CryptoKey | null>>()
function publicKey(ak: string) {
  let k = keys.get(ak)
  if (!k) {
    k = crypto.subtle
      .importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: ak }, { name: 'Ed25519' }, false, ['verify'])
      .catch(() => null) // no Ed25519 here: devices simply stay apart
    keys.set(ak, k)
  }
  return k
}

/** Is `p` a seat of the same account as `me`, by the server's signature? */
export async function isSameAccount(room: string, me: Participant, p: Participant): Promise<boolean> {
  const mine = metaOf(me)
  const theirs = metaOf(p)
  if (!mine.userId || !mine.ak || theirs.userId !== mine.userId || !theirs.as) return false
  const key = await publicKey(mine.ak)
  if (!key) return false
  try {
    const msg = new TextEncoder().encode(`${CLAIM_V}\n${room}\n${p.identity}\n${theirs.userId}`)
    return await crypto.subtle.verify('Ed25519', key, fromB64url(theirs.as), msg)
  } catch {
    return false
  }
}

/** SIDs of connections in this call that are your own other devices (verified). */
export function useMyOtherSeats(): ReadonlySet<string> {
  const room = useRoomContext()
  const [seats, setSeats] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    let alive = true
    const known = new Set<string>()
    const check = (r: Room) => {
      const me = r.localParticipant
      for (const p of r.remoteParticipants.values()) {
        const sid = p.sid
        if (!sid || known.has(sid)) continue
        void isSameAccount(r.name, me, p).then((yes) => {
          if (!alive || !yes || known.has(sid) || p.sid !== sid) return
          known.add(sid)
          setSeats(new Set(known))
        })
      }
    }
    const run = () => check(room)
    run()
    room
      .on(RoomEvent.Connected, run)
      .on(RoomEvent.ParticipantConnected, run)
      .on(RoomEvent.ParticipantMetadataChanged, run)
    return () => {
      alive = false
      room
        .off(RoomEvent.Connected, run)
        .off(RoomEvent.ParticipantConnected, run)
        .off(RoomEvent.ParticipantMetadataChanged, run)
    }
  }, [room])
  return seats
}
