/*
  Orchestration core — pure, env-injected, runtime-agnostic. Shared by the local
  Express dev server (server/token.mjs) and the Cloudflare Worker
  (worker/index.js) so the logic lives in exactly one place.

  Every handler takes (env, input) and returns { status, body }. `env` is
  process.env locally and the Worker's `env` binding in production. Uses only
  Web-standard APIs (global fetch, global crypto) so it runs on Workers.
*/
import { AccessToken, DataPacket_Kind, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk'
import { sendPush, pushConfigured } from './webpush.mjs'
import { seal, unseal } from './sealed.mjs'
import { seatKey, seatKeyValid, claimKey, claimKeyValid } from './seat.mjs'
import { accountClaim, accountPseudonym } from './account.mjs'
import { withoutE2eeKey } from './invite.mjs'
import { removedEntry, withRemoved, wasRemoved } from './removed.mjs'
import { roomTitle } from './preview.mjs'
import { writeWithRetry } from './queueWrite.mjs'

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escape user-supplied text before interpolating into email HTML. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c])
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A pending waiting-room entry self-expires after this long, so a guest never
// waits forever on a knock no one will action (host left / never opened admit).
// knock-status flips stale pending → expired; new knocks also prune by it.
const KNOCK_TTL_MS = 5 * 60 * 1000
/** Display names are shown on tiles and stored in the waiting-room queue. */
const MAX_NAME_LEN = 64
const MAX_ROOM_LEN = 128

// Link expiry. A link-shared room (one entered with an invite secret) is recorded
// in durable KV on join and refreshed on every join; if no one joins for LINK_TTL,
// the link is dead and the next knock is rejected. Without this a stale link silently
// spawns a FRESH room under the same slug — the LiveKit room (and its metadata) is
// garbage-collected minutes after it empties, so a 20-day-old link used to just
// recreate the room and "work". Mirrors the Zoom/Meet norm: expire on inactivity,
// extended by each join. Bare typed-name rooms (no secret) are unaffected.
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Hold the record far past the active window so "expired" stays distinguishable from
// "never existed" (an absent record = a brand-new room, which is allowed). An
// untouched slug only frees for reuse after a year.
const LINK_RECORD_TTL_S = 365 * 24 * 60 * 60
/** How stale the link's activity stamp may get before a join rewrites it. */
const LINK_STAMP_EVERY_MS = 6 * 60 * 60 * 1000

/** The room-lifecycle KV namespace, or null when unbound (local dev / unprovisioned).
 *  Degrades to a no-op exactly like the rate-limit bindings. */
function roomKv(env) {
  const kv = env?.ROOM_KV
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null
}

// Beta room-size cap. Enforced two ways: rejected at knock once a room is full, and
// stamped onto the LiveKit room (maxParticipants) at creation so the SFU enforces it
// even if a client connects without knocking first. Override via env for a different
// beta ceiling.
function roomCap(env) {
  return Number(env?.ROOM_CAP) || 10
}

// Current link epoch (mirrors LINK_EPOCH in src/lib/roomLink.ts). A fresh invite
// link's join secret is "<epoch>.<random>"; bumping this — or just shipping the
// epoch check, since legacy secrets carry no prefix — invalidates every old link.
function linkEpoch(env) {
  return String(env?.LINK_EPOCH || '1')
}

// The epoch a join secret was minted under, or null for a legacy (pre-epoch) secret.
// `.` never appears in a base64url secret, so the first dot unambiguously delimits it.
function secretEpoch(secret) {
  const s = String(secret || '')
  const i = s.indexOf('.')
  return i > 0 ? s.slice(0, i) : null
}

// Beta allowlist membership (opt-in gate via env.BETA_GATE === 'true'). An email is
// approved when `allow:<email>` exists in ROOM_KV — runtime-editable, so a tester is
// added without a redeploy. Gate off (default) → always allowed, so local dev and
// the pre-beta state are unaffected. Used host-gated: only approved accounts may
// START a room; their invited guests join the link without being on the list.
async function isAllowed(env, email) {
  const kv = roomKv(env)
  if (!kv || !email) return false
  try {
    return (await kv.get(`allow:${String(email).toLowerCase()}`)) != null
  } catch {
    return false
  }
}

/** SHA-256 hex of a string, via the Web Crypto API (available on Workers + Node). */
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function services(env) {
  const apiKey = env.LIVEKIT_API_KEY
  const apiSecret = env.LIVEKIT_API_SECRET
  const host = (env.VITE_LIVEKIT_URL || '').replace(/^ws/, 'http')
  const roomService = host && apiKey && apiSecret ? new RoomServiceClient(host, apiKey, apiSecret) : null
  return { apiKey, apiSecret, roomService }
}

async function mintToken(env, room, name, deviceId, isHost, userId) {
  const { apiKey, apiSecret } = services(env)
  const identity = `${name}#${deviceId || 'web'}`
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: '15m',
    // acct/ak/as: the account claim (server/account.mjs) that lets your other
    // devices in this call recognise this seat as yours. Never the account id
    // itself: everyone in the call can read this.
    metadata: JSON.stringify({ host: isHost, ...(await accountClaim(apiSecret, room, identity, userId)) }),
  })
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    roomAdmin: isHost,
  })
  // The seat key travels with every token and only ever to the client this token
  // was minted for; it's what lets that client (and only it) reclaim the seat.
  return { token: await at.toJwt(), identity, seat: await seatKey(apiSecret, room, identity) }
}

/** Like listParticipants, but a failed lookup THROWS instead of reading as "nobody
 *  here". A room that doesn't exist yet still answers [] (LiveKit doesn't error). */
async function listParticipantsStrict(roomService, room) {
  return roomService.listParticipants(room)
}

async function listParticipants(roomService, room) {
  try {
    return await roomService.listParticipants(room)
  } catch {
    return []
  }
}

/**
 * Resolve a participant's CURRENT published track sid for a given source by
 * asking the server for live participant info. The client passes a trackSid, but
 * after an admin-mute + the participant unmuting themselves that client-side sid
 * goes stale (the publication is re-keyed), so a second mute would target a dead
 * sid and silently no-op — that's the "can't mute them again" bug. The live sid
 * from getParticipant is always current. Returns null if it can't be resolved
 * (caller falls back to the client-supplied sid).
 */
async function resolveTrackSid(roomService, room, identity, source) {
  const want = source === 'camera' ? TrackSource.CAMERA : TrackSource.MICROPHONE
  try {
    const p = await roomService.getParticipant(room, identity)
    const track = (p?.tracks || []).find((t) => t.source === want)
    return track?.sid ?? null
  } catch {
    return null
  }
}

/** Like getRoomFlags, but a failed read THROWS instead of reading as {}: a writer
 *  that took {} for the truth would write over every key the room has. */
async function readRoomFlagsStrict(roomService, room) {
  const rooms = await roomService.listRooms([room])
  return rooms[0]?.metadata ? JSON.parse(rooms[0].metadata) : {}
}

/** LiveKit's "that room doesn't exist": an ANSWER, not a failure. A self-hosted
 *  server answers a lookup on an unopened or reaped room with an empty list;
 *  LiveKit Cloud answers 404 `not_found`. */
function isRoomNotFound(e) {
  return e?.status === 404 || e?.code === 'not_found'
}

/**
 * The knock's view of the room: its flags and who's in it, both read strictly.
 * The one difference from readRoomFlagsStrict + listParticipantsStrict: a room
 * LiveKit says doesn't exist reads as no flags and nobody here, which is the truth
 * for a new meeting or an old one whose room was reaped. Cloud says that with a
 * 404, and #48 took the 404 for "can't see the room", so the first person into
 * EVERY room got busy forever.
 *
 * Only when the two reads agree. A not_found from one read beside a room the other
 * can see is not "no room"; it fails closed like any other error, since an empty
 * roster there would let a knock under a live guest's identity skip its seat key.
 * Kept to the knock: the settings writes and the host election start from a room
 * the caller is IN, where a not_found is never the truth, and reading it as {}
 * would write over the lock and the secret, or elect over a present host.
 */
async function readKnockRoom(roomService, room) {
  const [roomsRes, peopleRes] = await Promise.allSettled([roomService.listRooms([room]), roomService.listParticipants(room)])
  if (roomsRes.status === 'rejected' && !isRoomNotFound(roomsRes.reason)) throw roomsRes.reason
  const rooms = roomsRes.status === 'fulfilled' ? roomsRes.value : []
  const exists = rooms.length > 0
  let participants
  if (peopleRes.status === 'fulfilled') participants = peopleRes.value
  else if (isRoomNotFound(peopleRes.reason) && !exists) participants = []
  else throw peopleRes.reason
  // listRooms said not_found, yet people are in it: the reads disagree.
  if (!exists && participants.length > 0 && roomsRes.status === 'rejected') throw roomsRes.reason
  const flags = rooms[0]?.metadata ? JSON.parse(rooms[0].metadata) : {}
  return { flags, participants }
}

async function getRoomFlags(roomService, room) {
  try {
    const rooms = await roomService.listRooms([room])
    return rooms[0]?.metadata ? JSON.parse(rooms[0].metadata) : {}
  } catch {
    return {}
  }
}

/** A settled (denied) waiting-room request is kept this long, so the guest's poll
 *  can still read "denied", then dropped. Approved ones stay: rejoining needs them. */
const DENIED_KEEP_MS = 10 * 60_000

/** The waiting-room queue, unsealed (server/sealed.mjs). A plain `queue` is what
 *  rooms created before sealing hold; it's replaced on the next write. */
async function readQueue(apiSecret, room, flags) {
  if (flags.queueSealed) return unseal(apiSecret, room, flags.queueSealed, [])
  return Array.isArray(flags.queue) ? flags.queue : []
}

/** Metadata patch that stores `queue` sealed, pruned, and clears the plain copy. */
async function queuePatch(apiSecret, room, queue, now = Date.now()) {
  const kept = queue.filter((e) => {
    if (e.status === 'pending') return now - (e.ts || now) < KNOCK_TTL_MS
    if (e.status === 'denied') return now - (e.settledAt || e.ts || now) < DENIED_KEEP_MS
    return true
  })
  return { queueSealed: await seal(apiSecret, room, kept.slice(-50)), queue: undefined }
}

/**
 * Change room flags so a concurrent change to them isn't lost.
 *
 * A plain read-modify-write isn't enough: two requests in different Worker
 * isolates interleave: a host flipping Lock while a guest knocks, a host removing
 * someone while a co-host admits, and the second write erased the first. This
 * re-reads after the write and redoes the change on top of whatever won
 * (server/queueWrite.mjs has the why and the limits). Every attempt starts from a
 * fresh STRICT read (a failed read throws and is retried; it never becomes `{}`
 * written over the room), and every key the change doesn't touch is carried along.
 *
 * `change(flags, attempt)` returns `{ patch, result }` to write `{...flags, ...patch}`,
 * or `{ done }` to stop without writing. `present(flags)` says whether this
 * request's change survived. `first` is an already-fresh, strictly-read copy of the
 * flags for attempt 0, only when nothing has been awaited since that read: with
 * awaits in between (a knock's KV and allowlist I/O) omit it and pay for a fresh read.
 *
 * Returns `{ ok: true, value }`, or `{ ok: false }` when it kept losing (or LiveKit
 * kept failing): the caller says "try again" rather than claiming success. Every
 * change pays the settle delay (~0.3s) before it answers; clients see the new flags
 * from the room-metadata event as soon as the first write lands, so a switch flips
 * just as fast as before — only the HTTP reply waits for the check.
 */
export function mutateRoomFlags(roomService, room, { change, present, first }, opts = {}) {
  return writeWithRetry({
    ...opts,
    first,
    read: () => readRoomFlagsStrict(roomService, room),
    write: (flags) => roomService.updateRoomMetadata(room, JSON.stringify(flags)),
    mutate: (flags, attempt) => change(flags, attempt),
    verify: (flags) => present(flags),
  })
}

/**
 * Change the waiting-room queue so a concurrent change to it isn't lost:
 * mutateRoomFlags over the unsealed queue. queuePatch still prunes before the 50-cap.
 *
 * `change(queue, attempt)` edits the unsealed queue in place and returns
 * `{ result }` to write it, or `{ done }` to stop without writing. `present(queue)`
 * says whether this request's change survived.
 */
export function mutateQueue(roomService, apiSecret, room, { change, present, now, first }, opts = {}) {
  return mutateRoomFlags(
    roomService,
    room,
    {
      first,
      change: async (flags, attempt) => {
        const queue = await readQueue(apiSecret, room, flags)
        const step = await change(queue, attempt)
        if ('done' in step) return step
        return { patch: await queuePatch(apiSecret, room, queue, now ?? Date.now()), result: step.result }
      },
      present: async (flags) => present(await readQueue(apiSecret, room, flags)),
    },
    opts,
  )
}

/**
 * Who last set each host-set flag: `flagRev[key]` is a random tag written with the
 * value. A value alone can't tell "a stale write put the old value back" (redo
 * mine) from "another host deliberately set it back" (theirs stands): both read as
 * the old value. The tag can — a stale writer carries the tag from BEFORE my
 * write, a deliberate one writes its own. Without it, two hosts flipping one
 * switch opposite ways would each keep redoing their own until both gave up.
 * Random, so it says nothing to the participants who can read room metadata.
 */
export const FLAG_REV = 'flagRev'
const revTag = () => crypto.randomUUID().slice(0, 8)
const revOf = (flags) => (flags[FLAG_REV] && typeof flags[FLAG_REV] === 'object' ? flags[FLAG_REV] : {})

/**
 * mutateRoomFlags op: set host-set flags (lock, waiting room, chat history,
 * annotateHostOnly, encrypted, the co-host roster). A key counts as kept while its
 * tag is ours, or anyone's but the one it had before we wrote (someone changed it
 * deliberately since: theirs stands). Only a key back at its pre-write tag — an
 * erased write — is redone. One case slips through: if a stale writer carrying a
 * THIRD host's tag lands after ours, it reads as "theirs stands" and our change is
 * reported done though the third host's value shows. The metadata is still the
 * truth the UI renders, so nobody is shown a switch in a state it isn't.
 * `guard(flags)` re-checks authority on the fresh flags
 * each attempt; returning anything but undefined stops with that as the answer.
 */
export function setFlagsOp(patch, { guard, tag = revTag() } = {}) {
  const keys = Object.keys(patch)
  /** Each key's tag as first seen, before any write of ours. */
  let before = null
  const kept = (rev, k) => rev[k] === tag || rev[k] !== before[k]
  return {
    change: (flags, attempt) => {
      const rev = revOf(flags)
      if (!before) before = Object.fromEntries(keys.map((k) => [k, rev[k]]))
      const stop = guard?.(flags)
      if (stop !== undefined) return { done: stop }
      const redo = attempt === 0 ? keys : keys.filter((k) => !kept(rev, k))
      if (redo.length === 0) return { done: true }
      const out = {}
      const nextRev = { ...rev }
      for (const k of redo) {
        out[k] = patch[k]
        nextRev[k] = tag
      }
      return { patch: { ...out, [FLAG_REV]: nextRev }, result: true }
    },
    present: (flags) => {
      if (!before) return false
      const rev = revOf(flags)
      return keys.every((k) => kept(rev, k))
    },
  }
}

/**
 * mutateRoomFlags op: move the primary seat from `priorHostId` (who's gone) to
 * `successor`. Every client that notices runs the same deterministic pick, so
 * concurrent elections agree; if another one moved the seat first (a different
 * snapshot of who's present), that answer stands and is the one reported. Kept
 * while the seat is still ours and its holder isn't also listed as a co-host.
 */
export function electOp(successor, priorHostId) {
  const prior = priorHostId || ''
  const roster = (flags) => (Array.isArray(flags.coHosts) ? flags.coHosts : [])
  const moved = (flags) => (flags.hostId || '') !== prior
  /** The seat our last write gave. Checked exactly, so an election that lost to a
   *  different pick re-reads and answers with the winner, not its own pick. */
  let wrote = null
  return {
    change: (flags) => {
      const coHosts = roster(flags)
      if (moved(flags) && !coHosts.includes(flags.hostId)) return { done: flags.hostId }
      // Another election moved it (but left its holder on the roster): finish that one.
      const seat = moved(flags) ? flags.hostId : successor
      const patch = { hostId: seat }
      if (coHosts.includes(seat)) {
        patch.coHosts = coHosts.filter((id) => id !== seat)
        patch[FLAG_REV] = { ...revOf(flags), coHosts: revTag() }
      }
      wrote = seat
      return { patch, result: seat }
    },
    present: (flags) => flags.hostId === wrote && !roster(flags).includes(wrote),
  }
}

/** mutateRoomFlags op: remember a removed participant (server/removed.mjs), once. */
export function rememberRemovedOp(entry) {
  const has = (flags) =>
    Array.isArray(flags.removed) && flags.removed.some((e) => e && e.d === entry.d && e.u === entry.u)
  return {
    change: (flags) => (has(flags) ? { done: true } : { patch: { removed: withRemoved(flags.removed, entry) }, result: true }),
    present: has,
  }
}

/**
 * mutateRoomFlags op: claim the unclaimed host seat for `identity`, with the join
 * secret's hash. Answers 'won' or 'lost' (someone else holds the seat: theirs
 * stands, and so does their secretHash). Written even when the seat already reads
 * as ours on attempt 0: the room may have just been created with it, and a knock
 * that read the room before it existed can still write over that.
 */
export function claimHostOp(identity, patch) {
  return {
    change: (flags, attempt) => {
      if (flags.hostId && flags.hostId !== identity) return { done: 'lost' }
      if (flags.hostId === identity && attempt > 0) return { done: 'won' }
      return { patch: { ...patch, hostId: identity }, result: 'won' }
    },
    present: (flags) => flags.hostId === identity,
  }
}

/**
 * The first-join host claim. At first join the room usually doesn't exist yet, and
 * updateRoomMetadata on a missing room fails — so create it with the claim in its
 * metadata, then verify the claim like any other flags write (claimHostOp). A
 * concurrent first-joiner's createRoom returns the existing room without touching
 * its metadata, so exactly one claim wins and the other learns it lost.
 * Returns 'won' | 'lost' | 'unknown' (LiveKit kept failing).
 */
async function claimHost(env, roomService, room, identity, patch) {
  let exists = true
  try {
    exists = (await roomService.listRooms([room])).length > 0
  } catch {
    /* unknown: let the verified write below find out */
  }
  let created = 'skipped'
  if (!exists) {
    try {
      // First-join room creation — stamp the beta size cap and idle timeouts so
      // the SFU enforces them itself: maxParticipants caps the room, emptyTimeout
      // reaps it shortly after the last person leaves, and departureTimeout closes
      // it quickly once empty — all quota protection that doesn't rely on a client
      // staying alive to end the call.
      await roomService.createRoom({
        name: room,
        metadata: JSON.stringify({ ...patch, hostId: identity }),
        maxParticipants: roomCap(env),
        emptyTimeout: 120,
        departureTimeout: 60,
      })
      created = 'ok'
    } catch (e) {
      created = `failed ${e?.status ?? ''} ${e?.code ?? e?.message ?? ''}`.trim()
      /* the verified write below retries, or reports it couldn't */
    }
  }
  const res = await mutateRoomFlags(roomService, room, claimHostOp(identity, patch))
  if (res.ok) return res.value
  // Say what LiveKit answered, so an unconfirmed claim on the deployed service can
  // be read off the Worker's logs instead of guessed at. Never the room name.
  let seen = 'unreadable'
  try {
    const rooms = await roomService.listRooms([room])
    seen = rooms.length ? `listed, metadata ${rooms[0].metadata ? 'set' : 'empty'}` : 'not listed'
  } catch (e) {
    seen = `list failed ${e?.status ?? ''} ${e?.code ?? ''}`.trim()
  }
  console.warn(`[claimHost] unconfirmed: existed=${exists} create=${created} room=${seen}`)
  return 'unknown'
}

/** mutateQueue op: add a knock's entry (once: a retry finds it already there). */
export function enqueueOp(entry) {
  return {
    change: (q) => {
      if (q.some((e) => e.id === entry.id)) return { done: true }
      q.push(entry)
      return { result: true }
    },
    present: (q) => q.some((e) => e.id === entry.id),
  }
}

/** mutateQueue op: a host's decision on one request. Attempt 0 behaves exactly as
 *  the plain write did; a retry first checks what happened while ours was lost. */
export function decideOp(requestId, approve, name) {
  const want = approve ? 'approved' : 'denied'
  return {
    change: (q, attempt) => {
      const e = q.find((x) => x.id === requestId)
      if (!e) return { done: { status: 404, body: { error: 'request not found' } } }
      if (attempt > 0) {
        // Our earlier write landed after all, or another host decided the same.
        if (e.status === want) return { done: { status: 200, body: { ok: true } } }
        // Another host decided the other way while ours was lost: theirs stands.
        if (e.status !== 'pending') {
          return { done: { status: 409, body: { error: 'Someone else already decided.', code: 'decided' } } }
        }
        // The guest renamed in the meantime: same rule as handleAdmit's own check.
        if (approve && typeof name === 'string' && name !== e.name) {
          return {
            done: { status: 409, body: { error: 'They changed their name. Check who’s waiting again.', code: 'renamed' } },
          }
        }
      }
      e.status = want
      e.settledAt = Date.now()
      return { result: { status: 200, body: { ok: true } } }
    },
    present: (q) => q.find((x) => x.id === requestId)?.status === want,
  }
}

/** The answer when a flags change couldn't be made to stick. */
const WRITE_BUSY = { status: 503, body: { error: 'Lots happening at once — try again.', code: 'busy' } }

// Resolve the caller's identity from their LiveKit JWT — the same token they hold
// to join the room. The signature is verified with the API secret, so the identity
// (`sub`) is unforgeable: a client cannot claim to be someone else. We also bind
// the token to the room it's acting on, so a host token for room A can't moderate
// room B. Returns the verified identity string, or null if absent/invalid.
async function verifyCaller(env, token, room) {
  const { apiKey, apiSecret } = services(env)
  if (!token || !apiKey || !apiSecret) return null
  try {
    const verifier = new TokenVerifier(apiKey, apiSecret)
    const claims = await verifier.verify(token)
    if (room && claims?.video?.room && claims.video.room !== room) return null
    return claims?.sub || null
  } catch {
    return null
  }
}

// Like verifyCaller, but also returns the account pseudonym baked into the SIGNED token
// metadata (set by the server at mint — immutable, unlike the live participant
// metadata a client can rewrite via canUpdateOwnMetadata). Used to authorize the
// device-handoff against an unforgeable account id.
async function verifyCallerClaims(env, token, room) {
  const { apiKey, apiSecret } = services(env)
  if (!token || !apiKey || !apiSecret) return null
  try {
    const verifier = new TokenVerifier(apiKey, apiSecret)
    const claims = await verifier.verify(token)
    if (room && claims?.video?.room && claims.video.room !== room) return null
    const identity = claims?.sub || null
    if (!identity) return null
    let acct = ''
    try {
      acct = JSON.parse(claims.metadata || '{}').acct || ''
    } catch {
      /* no/invalid metadata */
    }
    return { identity, acct }
  } catch {
    return null
  }
}

// Resolve the caller's TRUSTED account from their Supabase session token, the same
// way handlePushRing proves contact authorization. The client sends whatever it
// likes for `userId` at knock; trusting that lets a participant claim another user's
// id (and force-disconnect them via handoff). So we IGNORE the client value and
// derive it server-side: a valid Supabase access token → the verified { id, email };
// no/invalid token → null (an unauthenticated guest, who is device-bound anyway).
// Email comes from the same verified response and backs the beta allowlist gate.
async function verifySupabaseUser(env, accessToken) {
  const url = env.SUPABASE_URL
  const anon = env.SUPABASE_ANON_KEY
  if (!url || !anon || !accessToken) return null
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: anon, authorization: `Bearer ${accessToken}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    // Only trust a CONFIRMED email for the allowlist gate. If the project ever allows
    // signup without email confirmation, an unconfirmed account could claim an
    // allowlisted address it doesn't own and host. `email_confirmed_at` is the modern
    // field; `confirmed_at` is the older alias GoTrue still returns — accept either so
    // a version/field difference can't lock out a genuinely confirmed user. (Both OTP
    // and OAuth sign-in prove email ownership, so legitimate users always have one.)
    const verifiedEmail = u?.email_confirmed_at || u?.confirmed_at ? u.email || '' : ''
    return u?.id ? { id: u.id, email: verifiedEmail } : null
  } catch {
    return null
  }
}

// Host authority lives in ROOM metadata (written only by the server / a roomAdmin
// token), NOT participant metadata: tokens grant canUpdateOwnMetadata (needed for
// raise-hand attributes), so a participant could otherwise rewrite their own
// metadata to {host:true} and self-promote. Room metadata is unforgeable by
// non-host participants (they have roomAdmin:false).
//
// The caller proves identity by presenting their signed join token (Bearer) — NOT
// a plain identity string, which any participant can read off the room roster and
// replay. We verify the token, then check the verified identity matches the
// server-recorded hostId.
//
// Returns { ok, flags } rather than a bare boolean: the authority check has to read
// room metadata anyway, and every caller needs those same flags immediately after
// (the pending queue, the co-host roster). Handing the already-fetched copy back
// saves a duplicate listRooms on each call — which matters, because /api/pending is
// polled every 3s per host.
async function ensureHost(env, roomService, room, token) {
  const identity = await verifyCaller(env, token, room)
  if (!identity) return { ok: false, flags: {} }
  const flags = await getRoomFlags(roomService, room)
  // The primary host OR a promoted co-host. Co-hosts pass moderation/admit
  // checks; the server performs the privileged action with its own admin creds,
  // so co-hosts never need roomAdmin in their own join token.
  const ok =
    (Boolean(flags.hostId) && flags.hostId === identity) ||
    (Array.isArray(flags.coHosts) && flags.coHosts.includes(identity))
  return { ok, flags }
}

export function handleHealth(env) {
  const { apiKey, apiSecret } = services(env)
  // Server-side capability report for the client's setup-status surface. Only
  // booleans — never echo the actual keys.
  return {
    status: 200,
    body: {
      ok: true,
      hasKeys: Boolean(apiKey && apiSecret),
      email: Boolean(env.RESEND_API_KEY),
      // Whether the beta allowlist gate is on — lets the landing surface the
      // "approved hosts only" notice up front instead of after a failed knock.
      betaGate: env.BETA_GATE === 'true',
    },
  }
}

/**
 * "Can the current user start a call?" — lets the landing hide the private-beta
 * notice for an approved host and gate the New-meeting button precisely, instead of
 * showing a blanket banner. Authorizes the same way as knock: a verified Supabase
 * session → the trusted email → allowlist lookup. Gate off → everyone can host.
 * Never reveals other users' state (only the caller's own session is inspected).
 */
export async function handleMe(env, body) {
  const { accessToken } = body ?? {}
  const account = await verifySupabaseUser(env, accessToken)
  const email = account?.email || ''
  const gate = env.BETA_GATE === 'true'
  const allowed = !gate || (await isAllowed(env, email))

  return { status: 200, body: { signedIn: Boolean(account), betaGate: gate, allowed } }
}

export async function handleKnock(env, body, claimLost = false) {
  const { apiKey, apiSecret, roomService } = services(env)
  const { room, name, deviceId, host, accessToken, secret, seat, hasKey } = body ?? {}
  if (!room || !name) return { status: 400, body: { error: 'Enter your name to join.' } }
  if (!apiKey || !apiSecret) return { status: 500, body: { error: 'Calls aren’t available right now. Try again later.' } }
  // Bound what lands in the identity and in room metadata (the waiting-room queue
  // stores names, and LiveKit caps metadata size — a few huge names would make
  // every later knock's metadata write fail). `#` would make the identity's
  // name#device split ambiguous.
  if (typeof room !== 'string' || room.length > MAX_ROOM_LEN || typeof name !== 'string') {
    return { status: 400, body: { error: 'This call link isn’t valid. Check it and try again.' } }
  }
  if (name.length > MAX_NAME_LEN || /[#\u0000-\u001f\u007f]/.test(name) || !name.trim()) {
    return { status: 400, body: { error: 'Use a shorter name, without # or other special characters.' } }
  }
  if (deviceId != null && (typeof deviceId !== 'string' || deviceId.length > 64 || /[#\u0000-\u001f\u007f]/.test(deviceId))) {
    return { status: 400, body: { error: 'Couldn’t join from this browser. Try a different browser.' } }
  }

  const identity = `${name}#${deviceId || 'web'}`

  // Link epoch — reject pre-cutover invite links so the beta starts clean. A legacy
  // link's secret carries no epoch prefix; a superseded one carries an old epoch.
  // Bare typed-name rooms have no secret and are unaffected. Reuses the link_expired
  // code so the client shows its existing "start a new meeting" screen.
  if (secret && secretEpoch(secret) !== linkEpoch(env)) {
    return {
      status: 410,
      body: {
        error: 'This call link is no longer valid. Start a new call to keep talking.',
        code: 'link_expired',
      },
    }
  }

  // Every network read the knock needs, issued together. They are independent —
  // Supabase (who you are), LiveKit (the room's flags and who's in it) and KV (the
  // link's activity record) — and the join used to pay for them one after another:
  // three or four round trips, from wherever this Worker runs, before the call could
  // even start connecting. Now it pays for the slowest one.
  //
  // The link record is read only for a link-shared room (it carries a secret), and
  // every legitimate entrant there reads it anyway to stamp the link's activity, so
  // reading it early costs nothing extra on the path that matters.
  const kv = roomKv(env)
  const linkRoom = Boolean(kv) && Boolean(secret)
  const linkRead = linkRoom ? kv.get(`room:${room}`, 'json').catch(() => null) : Promise.resolve(null)
  // SERVER-DERIVED account — never the client-supplied `userId` (which a client can
  // set to any value, including a victim's, to spoof identity in handoff). A valid
  // Supabase session → the verified { id, email }; otherwise null (guest).
  // Read room flags in the same breath so host election keys off the recorded
  // hostId, not just a (racy) participant count. The recorded host reclaims host on
  // reconnect; a brand-new room with no host yet is claimed by its first occupant.
  //
  // Both LiveKit reads are STRICT: every gate below reads them, and a failed read
  // taken for "no flags, nobody here" turns the lock, the invite secret, the waiting
  // room and the removed list all off, and lets a knock under a live guest's
  // identity skip the seat key. A knock that can't see the room answers busy (the
  // client retries) rather than letting anyone in on a guess.
  let account, flags, participants
  try {
    let seen
    ;[account, seen] = await Promise.all([
      verifySupabaseUser(env, accessToken),
      roomService ? readKnockRoom(roomService, room) : { flags: null, participants: [] },
    ])
    ;({ flags, participants } = seen)
  } catch {
    return WRITE_BUSY
  }
  const userId = account?.id || ''
  const email = account?.email || ''

  if (!roomService) {
    // Degraded mode = no LiveKit configured (local UI-first dev). Host status is
    // unverifiable here and the host HTTP endpoints are disabled anyway (they all
    // require roomService), so a client-claimed `host` grants no real authority.
    // Still, only honor it behind an explicit dev opt-in so a MISCONFIGURED prod
    // (keys set but VITE_LIVEKIT_URL missing) never lets clients self-promote.
    const devHost = env.ALLOW_DEV_HOST === 'true' && Boolean(host)
    const minted = await mintToken(env, room, name, deviceId, devHost, userId)
    return { status: 200, body: { ...minted, host: devHost } }
  }

  const alreadyIn = participants.some((p) => p.identity === identity)
  // Is this same signed-in account ALREADY in the room on a DIFFERENT device? (Guests
  // are device-bound — a different device is a different guest userId — so this only
  // fires for a real shared account.) Surfaced to the client so prejoin can offer
  // "join anyway (companion, muted)" vs "transfer to this device". Authority is the
  // server-derived `userId`, never client-claimed, so it can't be spoofed.
  const acct = await accountPseudonym(apiSecret, room, userId)
  const alsoOnDevice =
    Boolean(acct) &&
    participants.some((p) => {
      if (p.identity === identity) return false
      try {
        return JSON.parse(p.metadata || '{}').acct === acct
      } catch {
        return false
      }
    })
  const queue = await readQueue(apiSecret, room, flags)
  // Already admitted this session? Someone the host let in, who then left, should
  // walk straight back in rather than re-queueing in the lobby (the "can't rejoin
  // after being allowed in" bug). Match on the stable name+device identity.
  const approvedBefore = queue.some(
    (e) => e.name === name && (e.deviceId || '') === (deviceId || '') && e.status === 'approved',
  )
  // Every privilege below that keys off an EXISTING identity — reclaiming host,
  // co-host, stepping back into a live seat, skipping the lobby — needs the seat
  // key minted for it (server/seat.mjs). Identities are public (the roster, and
  // hostId in metadata), so without this anyone who'd seen one could knock as it,
  // get its grants, and evict its owner.
  //  - Holding a seat (host, co-host, live) without the key is refused outright
  //    rather than downgraded: a plain token under that identity would still
  //    collide with the owner's session and still match hostId in ensureHost.
  //  - A past lobby approval without the key is just dropped, and the knock queues
  //    like any other. Nobody holds that seat, and the honest case is common: a
  //    guest who closed the tab while waiting and was approved anyway never
  //    received the key, and must not be told their own name is taken.
  const coHosts = Array.isArray(flags.coHosts) ? flags.coHosts : []
  const holdsSeat =
    identity === flags.hostId || coHosts.includes(identity) || participants.some((p) => p.identity === identity)
  const seatOk = (holdsSeat || approvedBefore) && (await seatKeyValid(apiSecret, room, identity, seat))
  if (holdsSeat && !seatOk) {
    return {
      status: 409,
      body: {
        error: 'Someone with this name is already part of this call. Change your name to join.',
        code: 'seat_taken',
      },
    }
  }
  const isHost = identity === flags.hostId || (participants.length === 0 && !flags.hostId)
  const wasApproved = approvedBefore && seatOk

  // Removed by the host: stays out, whatever name they use now (server/removed.mjs).
  if (!isHost && (await wasRemoved(flags.removed, deviceId, ''))) {
    return { status: 403, body: { error: 'The host removed you from this call.', code: 'removed' } }
  }

  // Beta allowlist gate (host-gated). Only an approved account may CREATE/hold a
  // room; their invited guests join the link without being on the list (still
  // bounded by the room cap). A non-approved account claiming host — a fresh room, a
  // bare typed name, or resurrecting a GC'd link room as its first occupant — is
  // rejected, so every room originates from an approved host and quota stays bounded.
  if (env.BETA_GATE === 'true' && isHost && !(await isAllowed(env, email))) {
    return {
      status: 403,
      body: {
        error: 'Only approved accounts can start calls during the beta. You can still join calls you’re invited to.',
        code: 'not_in_beta',
      },
    }
  }

  // Beta room-size cap. Reject once the room is full — backstops the maxParticipants
  // set on the LiveKit room (a client could otherwise connect without knocking). The
  // host reclaiming their seat and anyone already in bypass it (they aren't NEW load).
  if (!isHost && !alreadyIn && participants.length >= roomCap(env)) {
    return {
      status: 403,
      body: { error: 'This call is full. Try again later.', code: 'room_full' },
    }
  }

  // Link expiry (durable, KV-backed). Only link-shared rooms are governed; a room is
  // "expired" only when it ALSO has no live participants (a long-running call isn't
  // expired just because the last join was a while ago). An active room can't be
  // dead, so skip the check when anyone is in it.
  // Read once, up top with the other reads: the expiry check and the activity
  // stamp below both need it.
  const readLinkRec = () => linkRead
  if (linkRoom && participants.length === 0) {
    const rec = await readLinkRec()
    if (rec && Date.now() - (rec.lastJoinTs || 0) > LINK_TTL_MS) {
      return {
        status: 410,
        body: {
          error: 'This call link has expired. Start a new call to keep talking.',
          code: 'link_expired',
        },
      }
    }
  }

  if (!isHost && !alreadyIn && flags.locked) {
    return { status: 403, body: { error: 'The host has locked this call.', code: 'locked' } }
  }

  // Join-secret gate. Once a room records a secretHash (set by its creator from the
  // #fragment of the invite link), entry requires the matching secret — so the LINK
  // is the credential, not the guessable slug (closes room enumeration). The
  // recorded host (reconnecting), anyone already in, and a previously-approved guest
  // bypass it. Rooms with no secretHash (created by typing a bare name) stay open,
  // exactly as before — this only hardens link-shared rooms.
  if (flags.secretHash && !isHost && !alreadyIn && !wasApproved) {
    const ok = secret && (await sha256Hex(secret)) === flags.secretHash
    if (!ok) {
      // `code` so the client can tell this apart from every other 403 and clear a
      // STALE remembered secret (see src/lib/roomKeys) instead of retrying with it
      // forever. The wording names the failure the user can actually act on: the
      // link they opened lost its #fragment somewhere, so the one in their messages
      // is the one to re-open.
      return {
        status: 403,
        body: {
          error:
            'This link is incomplete. Open the original invite link again — shortened or retyped links don’t work.',
          code: 'need_link',
        },
      }
    }
  }

  // Encryption-key gate. A host whose encryption is on marks the room `encrypted`
  // (never the key — the server can't hold it). Someone arriving without the key,
  // usually from an emailed invite, which leaves it out on purpose, would join a
  // call they can't see or hear while their own camera and mic went out
  // unencrypted. Tell them at the door instead. `hasKey` is the client's word, so
  // this is a courtesy, not a control: a client that lies only hurts itself.
  // Absent (an older client) = no gate.
  if (flags.encrypted === true && hasKey === false && !alreadyIn) {
    return {
      status: 409,
      body: {
        error:
          'This call is end-to-end encrypted, and the link you opened doesn’t include its key. Ask whoever invited you for the full invite link.',
        code: 'need_key',
      },
    }
  }

  // Past the gate → a legitimate entrant. Stamp the link's activity so it stays alive
  // for another LINK_TTL window (createdAt is written once, the first time we see it).
  // At most every few hours: KV's free plan allows 1,000 writes a day, and this was
  // one per join — every person, every rejoin. Hours of slack on a 30-day window
  // changes nothing anyone could notice.
  if (linkRoom) {
    const prev = await readLinkRec()
    if (!prev || Date.now() - (prev.lastJoinTs || 0) >= LINK_STAMP_EVERY_MS) {
      try {
        await kv.put(
          `room:${room}`,
          JSON.stringify({ createdAt: prev?.createdAt ?? Date.now(), lastJoinTs: Date.now() }),
          { expirationTtl: LINK_RECORD_TTL_S },
        )
      } catch {
        /* KV write failed — non-fatal; joining still works, expiry just isn't refreshed */
      }
    }
  }

  if (isHost || alreadyIn || !flags.waiting || wasApproved) {
    // Record the authoritative host identity ONCE (only when unclaimed), server-side,
    // so it can't be forged via participant metadata (see ensureHost). The claim is
    // verified (claimHost): a knock writing at the same moment can't erase it, and of
    // two simultaneous first-joiners exactly one is host.
    if (isHost && !flags.hostId) {
      // Record the join-secret hash alongside the host identity, so subsequent
      // joiners must present the matching secret from the invite link. Store only
      // the hash — a metadata leak then never exposes the secret itself.
      const patch = {}
      if (secret) patch.secretHash = await sha256Hex(secret)
      const claim = await claimHost(env, roomService, room, identity, patch)
      // Someone else holds the seat. Everything above assumed we'd be host (it
      // skipped the lock, the secret and the waiting room), so knock again from the
      // top as who we really are: a guest, against the room as it now stands. Once.
      if (claim === 'lost' && !claimLost) return handleKnock(env, body, true)
      // A second loss in a row: the seat is someone else's and we've already
      // re-knocked once. Don't hand out a host token on top of theirs.
      if (claim === 'lost') return WRITE_BUSY
      // 'unknown': the claim couldn't be confirmed, but nothing says anyone else
      // holds the seat. Let the first arrival in as host anyway, the way joins
      // worked before claims were verified (#48). Refusing here locked EVERYONE out
      // on LiveKit Cloud, where a room nobody has connected to yet couldn't be
      // confirmed; the local --dev server can, so no test saw it.
      //
      // Safe now because `isHost` comes from STRICT reads (readKnockRoom): a
      // LiveKit failure answered busy before we got here, so "no host, nobody
      // here" is LiveKit's real answer, not a hiccup read as one. The cost is the
      // pre-#48 one: two people opening the same brand-new room in the same
      // instant could both be host, and the invite secret isn't recorded until
      // a later write lands.
    }
    const minted = await mintToken(env, room, name, deviceId, isHost, userId)
    return { status: 200, body: { ...minted, host: isHost, alsoOnDevice } }
  }

  // Waiting room is on and we're not auto-admitting. Don't queue against a host
  // who isn't connected — a `pending` entry no one can action would leave the
  // guest waiting indefinitely (a live `pending` has no client-visible timeout).
  // Reject with an actionable message instead; the guest can tap Join to retry.
  const hostLive = participants.some(
    (p) =>
      p.identity === flags.hostId ||
      (Array.isArray(flags.coHosts) && flags.coHosts.includes(p.identity)),
  )
  if (!hostLive) {
    return {
      status: 503,
      body: { error: 'The host isn’t here to let you in yet — try again in a moment.', code: 'host_absent' },
    }
  }

  const now = Date.now()
  const requestId = crypto.randomUUID()
  // queuePatch prunes stale pending and old denied entries BEFORE the 50-cap, so a
  // burst of dead knocks can't evict fresh ones — the earlier-pending-evicted-as-
  // expired bug — and the queue self-cleans. Approved entries are kept (rejoin needs
  // them). The whole queue is sealed: room metadata is readable by everyone in it.
  // Two guests knocking at once used to lose one of the two entries (the second
  // write replacing the first), and that guest then polled straight into "expired".
  // mutateQueue re-reads after writing and re-adds the entry if it went missing.
  const entry = { id: requestId, name, deviceId, userId: userId || '', status: 'pending', ts: now }
  const queued = await mutateQueue(roomService, apiSecret, room, { now, ...enqueueOp(entry) })
  if (!queued.ok) return WRITE_BUSY
  // Sealed or not, never let a request id alone be enough to collect the token:
  // the claim key is what knock-status actually honours, and only this caller has it.
  return { status: 200, body: { pending: true, requestId, claim: await claimKey(apiSecret, room, requestId) } }
}

/**
 * Who's in the call, for the join screen, before you knock. Read-only: it never
 * creates a room, claims host, queues anyone or stamps link activity.
 *
 * It says only what someone holding the invite link could find out by joining:
 * how many people are in, whether a host is among them, and whether the door is
 * a waiting room, locked, or full. Never names or identities.
 *
 * Without the link it learns nothing about who's inside: a room with a
 * join-secret answers `unknown` to a wrong or missing secret. (That a secret
 * room exists at all is no secret from here: knock already answers need_link
 * for one, and link slugs are random.)
 * Bare typed-name rooms have no secret, and anyone can knock on them anyway.
 */
export async function handleRoomStatus(env, body) {
  const { roomService } = services(env)
  const { room, secret, name, deviceId } = body ?? {}
  const unknown = { status: 200, body: { state: 'unknown' } }
  if (typeof room !== 'string' || !room || room.length > MAX_ROOM_LEN) return unknown
  if (secret != null && typeof secret !== 'string') return unknown
  if (!roomService) return unknown
  let flags
  let participants
  try {
    ;[flags, participants] = await Promise.all([getRoomFlags(roomService, room), listParticipants(roomService, room)])
  } catch {
    return unknown
  }
  if (flags.secretHash) {
    if (!secret || secretEpoch(secret) !== linkEpoch(env)) return unknown
    if ((await sha256Hex(secret)) !== flags.secretHash) return unknown
  }
  // Your own seat (a tab left open, the device you're rejoining from) isn't
  // someone waiting for you.
  const me = typeof name === 'string' && name ? `${name}#${typeof deviceId === 'string' && deviceId ? deviceId : 'web'}` : ''
  const others = participants.filter((p) => p.identity !== me)
  if (others.length === 0) return { status: 200, body: { state: 'empty' } }
  const coHosts = Array.isArray(flags.coHosts) ? flags.coHosts : []
  const hostHere = others.some((p) => p.identity === flags.hostId || coHosts.includes(p.identity))
  return {
    status: 200,
    body: {
      state: 'live',
      count: others.length,
      hostHere,
      // A hint for the copy only (grants nothing): you'd be walking back into your own call.
      youAreHost: Boolean(me) && me === flags.hostId,
      waiting: flags.waiting === true,
      locked: flags.locked === true,
      full: participants.length >= roomCap(env),
    },
  }
}

export async function handleKnockStatus(env, query) {
  const { roomService, apiSecret } = services(env)
  if (!roomService) return { status: 200, body: { status: 'expired' } }
  const { room, requestId, claim } = query
  // Without the claim key an approved request id — public in room metadata — would
  // mint the admitted guest's token for whoever polled it first.
  if (!(await claimKeyValid(apiSecret, room, requestId, claim))) {
    return { status: 403, body: { status: 'expired', error: 'Not your request' } }
  }
  // Strict: a failed read taken for {} has no queue, and would tell a guest the
  // host is about to admit that their request expired. A 5xx keeps them waiting.
  let flags
  try {
    flags = await readRoomFlagsStrict(roomService, room)
  } catch {
    return WRITE_BUSY
  }
  const queue = await readQueue(apiSecret, room, flags)
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return { status: 200, body: { status: 'expired' } }
  // A pending entry past its TTL is treated as expired — the host never actioned
  // it (left / missed the prompt), so stop the guest polling forever.
  if (entry.status === 'pending' && entry.ts && Date.now() - entry.ts > KNOCK_TTL_MS) {
    return { status: 200, body: { status: 'expired' } }
  }
  if (entry.status === 'approved') {
    // An approval from before a removal doesn't outlive it.
    if (await wasRemoved(flags.removed, entry.deviceId, '')) return { status: 200, body: { status: 'denied' } }
    // Checked again at the mint: the seat may have been taken since the knock
    // (or the rename), and an approval must never hand out someone else's seat.
    const identity = `${entry.name}#${entry.deviceId || 'web'}`
    // Strict: "nobody here" on a failed lookup would mint a seat someone is in.
    let participants
    try {
      participants = await listParticipantsStrict(roomService, room)
    } catch {
      return WRITE_BUSY
    }
    if (seatHeldBy(identity, flags, participants, queue, entry.id)) return { status: 200, body: { status: 'denied' } }
    const minted = await mintToken(env, room, entry.name, entry.deviceId, false, entry.userId)
    return { status: 200, body: { status: 'approved', ...minted } }
  }
  return { status: 200, body: { status: entry.status } }
}

/**
 * Is `identity` somebody's seat already: the host, a co-host, someone in the
 * call, or another request in the queue? A queued name must never become one
 * of those, or the host would be admitting a stranger INTO that seat: its
 * token matches hostId in ensureHost and evicts the real owner.
 */
function seatHeldBy(identity, flags, participants, queue, exceptId) {
  const coHosts = Array.isArray(flags.coHosts) ? flags.coHosts : []
  return (
    identity === flags.hostId ||
    coHosts.includes(identity) ||
    participants.some((p) => p.identity === identity) ||
    // Another guest waiting under it. (An old approval isn't a seat: nobody
    // is in it, and it's often this same guest back after closing the tab.)
    queue.some((e) => e.id !== exceptId && e.status === 'pending' && `${e.name}#${e.deviceId || 'web'}` === identity)
  )
}

/** Changes one waiting request may make: enough to fix a typo and reword a note. */
const MAX_KNOCK_EDITS = 6

/** A note to the host from the waiting room: one line, short enough for a banner. */
export const MAX_NOTE_LEN = 120

/**
 * A guest in the waiting room fixes their name or leaves the host a note. Only
 * the guest who knocked can (the same claim key knock-status needs), only while
 * the request is still pending, and under the same rules as a knock: the name
 * ends up in the identity the host admits, so a typo can be fixed before it's
 * in the call. The note is one short line with no control characters. Both
 * live in the sealed queue, so only a host reads them.
 */
export async function handleKnockUpdate(env, body) {
  const { roomService, apiSecret } = services(env)
  const { room, requestId, claim, name, note } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (typeof room !== 'string' || typeof requestId !== 'string' || typeof claim !== 'string') {
    return { status: 400, body: { error: 'bad request' } }
  }
  if (!(await claimKeyValid(apiSecret, room, requestId, claim))) {
    return { status: 403, body: { error: 'Not your request' } }
  }
  if (name != null && (typeof name !== 'string' || name.length > MAX_NAME_LEN || /[#\u0000-\u001f\u007f]/.test(name) || !name.trim())) {
    return { status: 400, body: { error: 'Use a shorter name, without # or other special characters.' } }
  }
  if (note != null && (typeof note !== 'string' || note.length > MAX_NOTE_LEN || /[\u0000-\u001f\u007f]/.test(note))) {
    return { status: 400, body: { error: `Keep the note to one line of ${MAX_NOTE_LEN} characters.` } }
  }
  // Strict, both: an empty read would say "you're no longer waiting" to someone
  // who is, and "nobody here" would let them rename into a live guest's seat.
  let flags, participants
  try {
    ;[flags, participants] = await Promise.all([readRoomFlagsStrict(roomService, room), listParticipantsStrict(roomService, room)])
  } catch {
    return WRITE_BUSY
  }
  const queue = await readQueue(apiSecret, room, flags)
  const entry = queue.find((e) => e.id === requestId)
  if (!entry || entry.status !== 'pending') return { status: 409, body: { error: 'You’re no longer waiting.' } }
  const nextName = name != null ? name.trim() : entry.name
  const nextNote = note != null ? note.trim() : entry.note || ''
  // Nothing changed: no metadata write (each one races the host's own writes).
  if (nextName === entry.name && nextNote === (entry.note || '')) {
    return { status: 200, body: { ok: true, name: entry.name, note: nextNote } }
  }
  if ((entry.edits || 0) >= MAX_KNOCK_EDITS) {
    return { status: 429, body: { error: 'You’ve changed this enough times. The host will see it as it is.' } }
  }
  if (nextName !== entry.name && seatHeldBy(`${nextName}#${entry.deviceId || 'web'}`, flags, participants, queue, entry.id)) {
    return {
      status: 409,
      body: { error: 'Someone with this name is already part of this call. Try another.', code: 'seat_taken' },
    }
  }
  // Applied to a fresh read each attempt (no base passed), so a host change made
  // while this was unsealing isn't written back over, and re-checked there: the
  // host may have settled it, or someone taken the name, in the meantime.
  const ok = { status: 200, body: { ok: true, name: nextName, note: nextNote } }
  const res = await mutateQueue(roomService, apiSecret, room, {
    change: (q) => {
      const e = q.find((x) => x.id === requestId)
      if (!e || e.status !== 'pending') return { done: { status: 409, body: { error: 'You’re no longer waiting.' } } }
      // An earlier attempt's write that landed after all.
      if (e.name === nextName && (e.note || '') === nextNote) return { done: ok }
      // Re-checked here too: two edits at once must not both slip under the cap.
      if ((e.edits || 0) >= MAX_KNOCK_EDITS) {
        return { done: { status: 429, body: { error: 'You’ve changed this enough times. The host will see it as it is.' } } }
      }
      if (e.name !== nextName && seatHeldBy(`${nextName}#${e.deviceId || 'web'}`, flags, participants, q, e.id)) {
        return {
          done: {
            status: 409,
            body: { error: 'Someone with this name is already part of this call. Try another.', code: 'seat_taken' },
          },
        }
      }
      e.name = nextName
      e.note = nextNote
      e.edits = (e.edits || 0) + 1
      return { result: ok }
    },
    present: (q) => {
      const e = q.find((x) => x.id === requestId)
      return Boolean(e) && e.name === nextName && (e.note || '') === nextNote
    },
  })
  return res.ok ? res.value : WRITE_BUSY
}

export async function handlePending(env, query, token) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { pending: [] } }
  const { room } = query
  const auth = await ensureHost(env, roomService, room, token)
  if (!auth.ok) return { status: 403, body: { error: 'host only' } }
  const pending = (await readQueue(services(env).apiSecret, room, auth.flags))
    .filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name, note: e.note || '' }))
  return { status: 200, body: { pending } }
}

export async function handleAdmit(env, body, token) {
  const { roomService, apiSecret } = services(env)
  const { room, requestId, approve, name } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  const auth = await ensureHost(env, roomService, room, token)
  if (!auth.ok) return { status: 403, body: { error: 'host only' } }
  const queue = await readQueue(apiSecret, room, auth.flags)
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return { status: 404, body: { error: 'request not found' } }
  // The guest can rename while waiting. Let in only the name the host was
  // shown; a newer one comes back to the banner to be decided on again.
  if (approve && typeof name === 'string' && name !== entry.name) {
    return { status: 409, body: { error: 'They changed their name. Check who’s waiting again.', code: 'renamed' } }
  }
  // Two hosts admitting at once used to lose one decision, leaving that guest
  // pending; mutateQueue redoes ours on top of the other one's.
  const res = await mutateQueue(roomService, apiSecret, room, {
    // Only local crypto awaited since the flags were read, so attempt 0 reuses them.
    first: auth.flags,
    ...decideOp(requestId, Boolean(approve), name),
  })
  return res.ok ? res.value : WRITE_BUSY
}

/**
 * Host ends the call for everyone — the AUTHORITATIVE close. The client also
 * broadcasts an `end` over the data channel for an instant local teardown, but
 * that frame is missed by anyone mid-reconnect, and once the host is gone nobody
 * can re-send it — they'd be stranded alone in a "closed" room. Deleting the room
 * server-side disconnects every participant (including reconnecting ones) and
 * blocks rejoins. Host-only via the same Bearer-token check as the other privileged
 * endpoints.
 */
export async function handleEndRoom(env, body, token) {
  const { roomService } = services(env)
  const { room } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room) return { status: 400, body: { error: 'room required' } }
  if (!(await ensureHost(env, roomService, room, token)).ok) return { status: 403, body: { error: 'host only' } }
  try {
    await roomService.deleteRoom(room)
    return { status: 200, body: { ok: true } }
  } catch {
    return { status: 502, body: { error: 'failed to end the call' } }
  }
}

/**
 * Host succession. `hostId` is written once at room creation and never moves, so
 * when the primary host leaves for good the host seat points at a ghost: the
 * co-host roster freezes (only the primary may edit it) and nobody can take over.
 * Any remaining participant may call this; the server only acts if the recorded
 * host is genuinely absent from the live roster, and picks the successor
 * DETERMINISTICALLY — the longest-present co-host, else the oldest participant
 * (by LiveKit joinedAt, identity as tiebreak). Because the choice is deterministic,
 * concurrent calls from every client converge on the same identity (no election
 * race), and it's idempotent: a no-op once any host is present. The departed host
 * therefore does NOT silently reclaim adminship on return (the recorded hostId has
 * moved on) — intentional.
 */
export async function handleElectHost(env, body, token) {
  const { roomService } = services(env)
  const { room } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room) return { status: 400, body: { error: 'room required' } }
  const caller = await verifyCaller(env, token, room)
  if (!caller) return { status: 401, body: { error: 'Your session expired — rejoin to continue.' } }

  let flags, participants
  try {
    // Strict: a failed read taken for {} would look like "no host" and elect one
    // over a host who's still here.
    ;[flags, participants] = await Promise.all([readRoomFlagsStrict(roomService, room), listParticipants(roomService, room)])
  } catch {
    return WRITE_BUSY
  }
  // Only a real occupant can trigger an election (no drive-by promotions).
  if (!participants.some((p) => p.identity === caller)) return { status: 403, body: { error: 'not in room' } }
  // Host still present, or the room's empty → nothing to elect.
  if (flags.hostId && participants.some((p) => p.identity === flags.hostId)) {
    return { status: 200, body: { ok: true, hostId: flags.hostId } }
  }
  if (participants.length === 0) return { status: 200, body: { ok: true, hostId: flags.hostId || '' } }

  const byTenure = (a, b) =>
    Number(a.joinedAt || 0) - Number(b.joinedAt || 0) ||
    // Plain code-unit order, not locale order: clients compute the same pick
    // (useSessionControl) to decide who asks first.
    (String(a.identity) < String(b.identity) ? -1 : String(a.identity) > String(b.identity) ? 1 : 0)
  const coHosts = Array.isArray(flags.coHosts) ? flags.coHosts : []
  const presentCoHosts = participants.filter((p) => coHosts.includes(p.identity)).sort(byTenure)
  const successor = (presentCoHosts[0] || [...participants].sort(byTenure)[0]).identity

  // The new primary shouldn't also sit in its own co-host list (electOp). Deliberately
  // NOT passing the flags read above as `first`: they were fetched in parallel with
  // listParticipants, so by the time that settles they're already a round-trip
  // stale. Election is rare — pay for the fresh read, and verify it stuck: a knock's
  // queue write that read before ours would otherwise put the absent host back.
  const res = await mutateRoomFlags(roomService, room, electOp(successor, flags.hostId))
  if (!res.ok) return WRITE_BUSY
  return { status: 200, body: { ok: true, hostId: res.value } }
}

/**
 * Multi-device handoff: drop the caller's OWN other sessions in this room (used by
 * the "switch to this device" banner). This MUST be server-mediated, not a
 * client-trusted data-channel broadcast: the old client path authorized on
 * self-asserted participant metadata, so a participant could set their userId to a
 * victim's and force-disconnect them (a targeted DoS). Here authority is the userId
 * in the caller's SIGNED token (set by the server at mint, validated against the
 * Supabase session — unforgeable), and we only remove participants whose account id
 * matches the caller's. A victim's real id differs and they can't be made to match,
 * so the worst an attacker can do is disconnect their own devices.
 */
export async function handleHandoff(env, body, token) {
  const { roomService } = services(env)
  const { room, keepDevice } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room) return { status: 400, body: { error: 'room required' } }
  const caller = await verifyCallerClaims(env, token, room)
  if (!caller) return { status: 401, body: { error: 'Your session expired — rejoin to continue.' } }
  // Guests have no account id and are device-bound: nothing to hand off.
  if (!caller.acct) return { status: 200, body: { ok: true, dropped: 0 } }

  const participants = await listParticipants(roomService, room)
  let dropped = 0
  await Promise.all(
    participants.map(async (p) => {
      if (p.identity === caller.identity) return
      let pAcct = ''
      try {
        pAcct = JSON.parse(p.metadata || '{}').acct || ''
      } catch {
        /* no metadata */
      }
      const device = String(p.identity).split('#').slice(1).join('#')
      if (pAcct && pAcct === caller.acct && device !== keepDevice) {
        try {
          // Tell that device it moved BEFORE removing it: LiveKit reports any
          // removal as "removed", and the end-of-call screen would say the host
          // threw you out. Server-sent, so no participant can forge it.
          await roomService
            .sendData(room, new TextEncoder().encode(JSON.stringify({ type: 'moved' })), DataPacket_Kind.RELIABLE, {
              destinationIdentities: [p.identity],
              topic: 'mn.control',
            })
            .catch(() => {})
          await new Promise((r) => setTimeout(r, 300))
          await roomService.removeParticipant(room, p.identity)
          dropped++
        } catch {
          /* already gone */
        }
      }
    }),
  )
  return { status: 200, body: { ok: true, dropped } }
}

export async function handleModerate(env, body, token) {
  const { roomService } = services(env)
  const { room, target, action, trackSid, source } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room || !target || !action) return { status: 400, body: { error: 'missing fields' } }
  const modIdentity = await verifyCaller(env, token, room)
  if (!modIdentity) return { status: 401, body: { error: 'Your session expired — rejoin to moderate.' } }
  const modFlags = await getRoomFlags(roomService, room)
  const modIsPrimaryHost = modFlags.hostId === modIdentity
  const modIsHost =
    modIsPrimaryHost ||
    (Array.isArray(modFlags.coHosts) && modFlags.coHosts.includes(modIdentity))
  if (!modIsHost) return { status: 403, body: { error: 'Host only.' } }
  // A co-host can't remove or mute the primary host — only the primary host has
  // authority over the host seat. (Co-hosts moderating each other / attendees is
  // fine.) Prevents a promoted co-host from kicking the host out of their own call.
  if (target === modFlags.hostId && !modIsPrimaryHost) {
    return { status: 403, body: { error: 'Only the host can do that.' } }
  }
  if (action === 'remove') {
    if (target === modIdentity) return { status: 400, body: { error: 'You can’t remove yourself — use Leave.' } }
    // Remember them first, so a fast re-knock can't slip in between (server/removed.mjs).
    // Keyed on the device only: the account id in live participant metadata is
    // client-writable, so trusting it would let someone get ANOTHER person's
    // account banned by copying their id and getting themselves removed.
    // Verified, not just written: an admit or a knock that read before this write
    // and wrote after it would erase the entry, and the removed guest could knock
    // straight back in. That costs ~0.3s before they're disconnected (seconds, if
    // LiveKit is failing and the write keeps retrying: remembering them BEFORE
    // removing them is the point, so that wait is kept).
    // Best effort: a failed write must never stop the removal itself. The read is
    // strict, so a failed lookup is retried, never taken for {} and written over
    // hostId, the queue and the join secret.
    try {
      const entry = await removedEntry(target, '')
      if (entry) await mutateRoomFlags(roomService, room, rememberRemovedOp(entry))
    } catch {
      /* the removal below still happens */
    }
    await roomService.removeParticipant(room, target)
  } else if (action === 'mute') {
    // Prefer the live sid (handles the stale-sid re-mute bug); fall back to the
    // client-supplied one if we couldn't look it up.
    const sid = (await resolveTrackSid(roomService, room, target, source)) || trackSid
    if (!sid) return { status: 400, body: { error: 'trackSid required' } }
    await roomService.mutePublishedTrack(room, target, sid, true)
  } else {
    return { status: 400, body: { error: 'unknown action' } }
  }
  return { status: 200, body: { ok: true } }
}

export async function handleRoomflags(env, body, token) {
  const { roomService } = services(env)
  const { room, locked, waiting, annotateHostOnly, chatHistory, encrypted, coHosts } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  const identity = await verifyCaller(env, token, room)
  if (!identity) return { status: 401, body: { error: 'Your session expired — rejoin to continue.' } }
  let flags
  try {
    // Strict: it's the merge base for attempt 0 below.
    flags = await readRoomFlagsStrict(roomService, room)
  } catch {
    return WRITE_BUSY
  }
  const primaryIn = (f) => Boolean(f.hostId) && f.hostId === identity
  const coIn = (f) => Array.isArray(f.coHosts) && f.coHosts.includes(identity)
  const isPrimary = primaryIn(flags)
  const isCo = coIn(flags)
  if (!isPrimary && !isCo) return { status: 403, body: { error: 'Host only.' } }

  const patch = {}
  if (typeof locked === 'boolean') patch.locked = locked
  if (typeof waiting === 'boolean') patch.waiting = waiting
  // Annotation policy. Either host tier may set it (unlike the co-host roster) —
  // it's a moderation control over the shared screen, not a change to who holds
  // authority. Absent/false means everyone in the room may draw.
  if (typeof annotateHostOnly === 'boolean') patch.annotateHostOnly = annotateHostOnly
  // Whether people who join later are shown earlier chat. Absent = on (the
  // behaviour rooms always had); enforced by the peers that replay it.
  if (typeof chatHistory === 'boolean') patch.chatHistory = chatHistory
  // One way: once a host with encryption on has marked the room, nobody can
  // unmark it for the room's lifetime (it resets when the room empties).
  if (encrypted === true) patch.encrypted = true
  if (coHosts !== undefined) {
    // Only the primary host may change the co-host roster — otherwise a co-host
    // could demote the host or promote allies.
    if (!isPrimary) return { status: 403, body: { error: 'only the host can change co-hosts' } }
    if (!Array.isArray(coHosts)) return { status: 400, body: { error: 'coHosts must be an array' } }
    patch.coHosts = coHosts
      .filter((x) => typeof x === 'string' && x && x !== flags.hostId)
      .slice(0, 20)
  }
  if (Object.keys(patch).length === 0) return { status: 400, body: { error: 'nothing to update' } }
  // Patch built synchronously from the read above, so it's attempt 0's base. A
  // retry re-checks authority on the fresh flags: a host demoted while their write
  // was being erased doesn't get to redo it.
  const HOST_ONLY = { status: 403, body: { error: 'Host only.' } }
  const res = await mutateRoomFlags(roomService, room, {
    first: flags,
    ...setFlagsOp(patch, {
      guard: (f) => {
        if (patch.coHosts !== undefined) return primaryIn(f) ? undefined : HOST_ONLY
        return primaryIn(f) || coIn(f) ? undefined : HOST_ONLY
      },
    }),
  })
  if (!res.ok) return WRITE_BUSY
  if (res.value !== true) return res.value
  return { status: 200, body: { ok: true, ...patch } }
}

/**
 * `appOrigin` is where this deployment serves the app (the Worker passes the
 * origin of the URL the request hit). When given, the link must point there;
 * without it (the local dev server, behind Vite's proxy) only the path is checked.
 */
export async function handleEmailInvite(env, body, token, appOrigin) {
  const { to, room, link } = body ?? {}
  if (!to || !link) return { status: 400, body: { error: 'to and link required' } }
  // Require a valid join token for the room being invited to. Without this the
  // endpoint is an open relay: anyone could make our verified Resend domain send
  // "X invited you to a Manim call" to arbitrary addresses (spam / reputation
  // burn). The token is the same signed LiveKit token the inviter holds in-call,
  // bound to this room (verifyCaller rejects a token minted for another room).
  if (!room) return { status: 400, body: { error: 'room required' } }
  const caller = await verifyCaller(env, token, room)
  if (!caller) {
    return { status: 401, body: { error: 'Join the call before inviting others.' } }
  }
  // Validate the recipient + the link. The link must be an http(s) URL — this
  // prevents javascript:/data: payloads and limits the endpoint to sending
  // join links, not arbitrary content.
  if (!EMAIL_RE.test(String(to))) return { status: 400, body: { error: 'invalid recipient' } }
  let url
  try {
    url = new URL(String(link))
  } catch {
    return { status: 400, body: { error: 'invalid link' } }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { status: 400, body: { error: 'invalid link' } }
  }
  // And it must be THIS room on THIS app. Any http(s) link used to pass, which let
  // anyone who'd joined any open room send mail from our verified domain, under a
  // name of their choosing, to a destination of their choosing: a phishing kit.
  // (The #fragment carries the room's secrets and is left alone.)
  // Compared decoded, trailing slash ignored: browsers keep `:@+,;=&$` literal in a
  // path and may lowercase percent-hex, so the raw form of a real link can differ
  // from encodeURIComponent's.
  let path
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+$/, '')
  } catch {
    return { status: 400, body: { error: 'invalid link' } }
  }
  if ((appOrigin && url.origin !== appOrigin) || path !== `/r/${room}`) {
    return { status: 400, body: { error: 'invalid link' } }
  }
  const key = env.RESEND_API_KEY
  if (!key) return { status: 501, body: { error: 'email not configured' } }
  const from = env.RESEND_FROM || 'Manim <onboarding@resend.dev>'
  // All interpolated values are escaped — they come from the client.
  // The sender is who the signed token says, not a free-text field.
  const sender = String(caller).split('#')[0].slice(0, 64) || 'Someone'
  const who = escapeHtml(sender)
  const safeRoom = room ? escapeHtml(roomTitle(room)) : ''
  // Never mail the encryption key (server/invite.mjs). The join secret stays, so
  // the link still opens the room. The client strips it first, so whether to say
  // "encrypted" comes from the room's own flag as well as the link.
  const { url: mailed, hadKey } = withoutE2eeKey(url.href)
  const { roomService } = services(env)
  const encrypted = hadKey || (roomService ? (await getRoomFlags(roomService, room)).encrypted === true : false)
  const href = escapeHtml(mailed.href)
  const encryptedNote = encrypted
    ? `<p>This call is end-to-end encrypted, so its encryption key isn’t in this email. Ask ${who} to send you the full link to join with encryption.</p>`
    : ''
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [String(to)],
      // Plain text, not HTML — escaping here would mail "O&#39;Neil invited you".
      // Knock already refuses control characters in names, so no header tricks.
      subject: `${sender} invited you to a Manim call`,
      // A text part too: some clients show only that, and spam filters mark down
      // HTML-only mail. Plain, so no escaping (as with the subject).
      text: [
        `${sender} invited you to a Manim call${room ? `: ${roomTitle(room)}` : ''}.`,
        `Join the call: ${mailed.href}`,
        ...(encrypted
          ? [`This call is end-to-end encrypted, so its encryption key isn’t in this email. Ask ${sender} to send you the full link to join with encryption.`]
          : []),
      ].join('\n\n'),
      html: `<p>${who} invited you to a Manim call${safeRoom ? `: <b>${safeRoom}</b>` : ''}.</p>
             <p><a href="${href}">Join the call</a></p><p style="color:#888">${href}</p>${encryptedNote}`,
    }),
  })
  if (!r.ok) return { status: 502, body: { error: 'email send failed' } }
  return { status: 200, body: { ok: true } }
}

/**
 * Fan out a background Web Push to a contact's devices when ringing them (so the
 * call reaches them even with the tab backgrounded / on mobile). The caller proves
 * authorization with their OWN Supabase access token: we resolve the target's push
 * subscriptions via the `get_push_targets` SECURITY DEFINER RPC, which only returns
 * rows when the caller is an accepted contact. The VAPID private key never leaves
 * the server. Best-effort + payload-less — the in-app Realtime ring carries the
 * details; this just wakes the device. No-op when push/Supabase isn't configured.
 */
export async function handlePushRing(env, body) {
  const { targetId, accessToken } = body ?? {}
  if (!targetId || !accessToken) return { status: 400, body: { error: 'missing fields' } }
  const url = env.SUPABASE_URL
  const anon = env.SUPABASE_ANON_KEY
  if (!url || !anon || !pushConfigured(env)) return { status: 200, body: { ok: false, sent: 0 } }

  let subs = []
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/get_push_targets`, {
      method: 'POST',
      headers: { apikey: anon, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ target_id: targetId }),
    })
    if (r.ok) subs = await r.json()
  } catch {
    /* network / RPC error — nothing to push */
  }
  if (!Array.isArray(subs) || subs.length === 0) return { status: 200, body: { ok: true, sent: 0 } }

  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        const st = await sendPush(env, s.endpoint)
        if (st >= 200 && st < 300) sent++
        // 404/410 (gone) isn't pruned here: only the subscription's owner may delete
        // it, and letting a caller do so would let any contact switch off someone's
        // push. Supabase drops subscriptions no device has renewed in 60 days
        // (DEPLOY.md §4c), and a live device renews its own on every app start.
      } catch {
        /* one dead endpoint shouldn't fail the others */
      }
    }),
  )
  return { status: 200, body: { ok: true, sent } }
}
