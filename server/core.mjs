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
import { withoutE2eeKey } from './invite.mjs'
import { removedEntry, withRemoved, wasRemoved } from './removed.mjs'
import { roomTitle } from './preview.mjs'

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
    metadata: JSON.stringify({ host: isHost, userId: userId || '' }),
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

async function getRoomFlags(roomService, room) {
  try {
    const rooms = await roomService.listRooms([room])
    return rooms[0]?.metadata ? JSON.parse(rooms[0].metadata) : {}
  } catch {
    return {}
  }
}

/**
 * Read-modify-write of room metadata. The read is what stops a concurrent writer's
 * unrelated keys from being clobbered, so it is NOT optional in general — but a
 * caller that already holds a fresh copy can pass it as `current` to skip a second
 * listRooms round-trip. Only pass it when nothing has been awaited since that read
 * (the window is then effectively zero); when there are awaits in between — knock,
 * which does KV and allowlist I/O — omit it and pay for the fresh read.
 */
async function mergeRoomFlags(roomService, room, patch, current) {
  const base = current ?? (await getRoomFlags(roomService, room))
  await roomService.updateRoomMetadata(room, JSON.stringify({ ...base, ...patch }))
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

// Like verifyCaller, but also returns the userId baked into the SIGNED token
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
    let userId = ''
    try {
      userId = JSON.parse(claims.metadata || '{}').userId || ''
    } catch {
      /* no/invalid metadata */
    }
    return { identity, userId }
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

export async function handleKnock(env, body) {
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
  // SERVER-DERIVED account — never the client-supplied `userId` (which a client can
  // set to any value, including a victim's, to spoof identity in handoff). A valid
  // Supabase session → the verified { id, email }; otherwise null (guest).
  const account = await verifySupabaseUser(env, accessToken)
  const userId = account?.id || ''
  const email = account?.email || ''

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

  // Read room flags FIRST so host election keys off the recorded hostId, not just
  // a (racy) participant count. The recorded host reclaims host on reconnect; a
  // brand-new room with no host yet is claimed by its first occupant.
  // Independent reads — issue them together so the join path pays for one round-trip
  // instead of two.
  const [flags, participants] = await Promise.all([
    getRoomFlags(roomService, room),
    listParticipants(roomService, room),
  ])
  const alreadyIn = participants.some((p) => p.identity === identity)
  // Is this same signed-in account ALREADY in the room on a DIFFERENT device? (Guests
  // are device-bound — a different device is a different guest userId — so this only
  // fires for a real shared account.) Surfaced to the client so prejoin can offer
  // "join anyway (companion, muted)" vs "transfer to this device". Authority is the
  // server-derived `userId`, never client-claimed, so it can't be spoofed.
  const alsoOnDevice =
    Boolean(userId) &&
    participants.some((p) => {
      if (p.identity === identity) return false
      try {
        return JSON.parse(p.metadata || '{}').userId === userId
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
  const kv = roomKv(env)
  const linkRoom = kv && Boolean(secret)
  if (linkRoom && participants.length === 0) {
    let rec = null
    try {
      rec = await kv.get(`room:${room}`, 'json')
    } catch {
      rec = null
    }
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
  if (linkRoom) {
    try {
      const prev = await kv.get(`room:${room}`, 'json')
      await kv.put(
        `room:${room}`,
        JSON.stringify({ createdAt: prev?.createdAt ?? Date.now(), lastJoinTs: Date.now() }),
        { expirationTtl: LINK_RECORD_TTL_S },
      )
    } catch {
      /* KV write failed — non-fatal; joining still works, expiry just isn't refreshed */
    }
  }

  if (isHost || alreadyIn || !flags.waiting || wasApproved) {
    // Record the authoritative host identity ONCE (only when unclaimed), server-side,
    // so it can't be forged via participant metadata (see ensureHost) and a second
    // simultaneous first-join can't overwrite it. At first-join the room doesn't
    // exist yet, so updateRoomMetadata would fail — create it with the metadata
    // instead. (LiveKit auto-creates the room on connect either way.)
    if (isHost && !flags.hostId) {
      // Record the join-secret hash alongside the host identity, so subsequent
      // joiners must present the matching secret from the invite link. Store only
      // the hash — a metadata leak then never exposes the secret itself.
      const patch = { hostId: identity }
      if (secret) patch.secretHash = await sha256Hex(secret)
      try {
        await mergeRoomFlags(roomService, room, patch)
      } catch {
        try {
          // First-join room creation — stamp the beta size cap and idle timeouts so
          // the SFU enforces them itself: maxParticipants caps the room, emptyTimeout
          // reaps it shortly after the last person leaves, and departureTimeout closes
          // it quickly once empty — all quota protection that doesn't rely on a client
          // staying alive to end the call.
          await roomService.createRoom({
            name: room,
            metadata: JSON.stringify(patch),
            maxParticipants: roomCap(env),
            emptyTimeout: 120,
            departureTimeout: 60,
          })
        } catch {
          /* non-fatal: host UI/moderation degrades, joining still works */
        }
      }
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
  const next = [...queue, { id: requestId, name, deviceId, userId: userId || '', status: 'pending', ts: now }]
  await mergeRoomFlags(roomService, room, await queuePatch(apiSecret, room, next, now))
  // Sealed or not, never let a request id alone be enough to collect the token:
  // the claim key is what knock-status actually honours, and only this caller has it.
  return { status: 200, body: { pending: true, requestId, claim: await claimKey(apiSecret, room, requestId) } }
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
  const flags = await getRoomFlags(roomService, room)
  const entry = (await readQueue(apiSecret, room, flags)).find((e) => e.id === requestId)
  if (!entry) return { status: 200, body: { status: 'expired' } }
  // A pending entry past its TTL is treated as expired — the host never actioned
  // it (left / missed the prompt), so stop the guest polling forever.
  if (entry.status === 'pending' && entry.ts && Date.now() - entry.ts > KNOCK_TTL_MS) {
    return { status: 200, body: { status: 'expired' } }
  }
  if (entry.status === 'approved') {
    // An approval from before a removal doesn't outlive it.
    if (await wasRemoved(flags.removed, entry.deviceId, '')) return { status: 200, body: { status: 'denied' } }
    const minted = await mintToken(env, room, entry.name, entry.deviceId, false, entry.userId)
    return { status: 200, body: { status: 'approved', ...minted } }
  }
  return { status: 200, body: { status: entry.status } }
}

export async function handlePending(env, query, token) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { pending: [] } }
  const { room } = query
  const auth = await ensureHost(env, roomService, room, token)
  if (!auth.ok) return { status: 403, body: { error: 'host only' } }
  const pending = (await readQueue(services(env).apiSecret, room, auth.flags))
    .filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name }))
  return { status: 200, body: { pending } }
}

export async function handleAdmit(env, body, token) {
  const { roomService, apiSecret } = services(env)
  const { room, requestId, approve } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  const auth = await ensureHost(env, roomService, room, token)
  if (!auth.ok) return { status: 403, body: { error: 'host only' } }
  const queue = await readQueue(apiSecret, room, auth.flags)
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return { status: 404, body: { error: 'request not found' } }
  entry.status = approve ? 'approved' : 'denied'
  entry.settledAt = Date.now()
  // Only local crypto awaited since the flags were read, so reuse them.
  await mergeRoomFlags(roomService, room, await queuePatch(apiSecret, room, queue), auth.flags)
  return { status: 200, body: { ok: true } }
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

  const [flags, participants] = await Promise.all([
    getRoomFlags(roomService, room),
    listParticipants(roomService, room),
  ])
  // Only a real occupant can trigger an election (no drive-by promotions).
  if (!participants.some((p) => p.identity === caller)) return { status: 403, body: { error: 'not in room' } }
  // Host still present, or the room's empty → nothing to elect.
  if (flags.hostId && participants.some((p) => p.identity === flags.hostId)) {
    return { status: 200, body: { ok: true, hostId: flags.hostId } }
  }
  if (participants.length === 0) return { status: 200, body: { ok: true, hostId: flags.hostId || '' } }

  const byTenure = (a, b) =>
    Number(a.joinedAt || 0) - Number(b.joinedAt || 0) ||
    String(a.identity).localeCompare(String(b.identity))
  const coHosts = Array.isArray(flags.coHosts) ? flags.coHosts : []
  const presentCoHosts = participants.filter((p) => coHosts.includes(p.identity)).sort(byTenure)
  const successor = (presentCoHosts[0] || [...participants].sort(byTenure)[0]).identity

  // The new primary shouldn't also sit in its own co-host list. Deliberately NOT
  // passing the flags read above as the merge base: they were fetched in parallel
  // with listParticipants, so by the time that settles they're already a round-trip
  // stale, and a knock landing in that gap would get its queue entry clobbered.
  // Election is rare — pay for the fresh read.
  await mergeRoomFlags(roomService, room, {
    hostId: successor,
    coHosts: coHosts.filter((id) => id !== successor),
  })
  return { status: 200, body: { ok: true, hostId: successor } }
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
  if (!caller.userId) return { status: 200, body: { ok: true, dropped: 0 } }

  const participants = await listParticipants(roomService, room)
  let dropped = 0
  await Promise.all(
    participants.map(async (p) => {
      if (p.identity === caller.identity) return
      let pUserId = ''
      try {
        pUserId = JSON.parse(p.metadata || '{}').userId || ''
      } catch {
        /* no metadata */
      }
      const device = String(p.identity).split('#').slice(1).join('#')
      if (pUserId && pUserId === caller.userId && device !== keepDevice) {
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
    // Best effort: a failed write must never stop the removal itself, and an
    // empty read (the lookup failed) must not become the merge base, or the
    // write would wipe hostId, the queue and the join secret.
    try {
      const entry = await removedEntry(target, '')
      const fresh = await getRoomFlags(roomService, room)
      if (entry && Object.keys(fresh).length > 0) {
        await mergeRoomFlags(roomService, room, { removed: withRemoved(fresh.removed, entry) }, fresh)
      }
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
  const flags = await getRoomFlags(roomService, room)
  const isPrimary = Boolean(flags.hostId) && flags.hostId === identity
  const isCo = Array.isArray(flags.coHosts) && flags.coHosts.includes(identity)
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
  // Patch built synchronously from the read above — no re-read needed.
  await mergeRoomFlags(roomService, room, patch, flags)
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
