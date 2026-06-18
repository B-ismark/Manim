/*
  Orchestration core — pure, env-injected, runtime-agnostic. Shared by the local
  Express dev server (server/token.mjs) and the Cloudflare Worker
  (worker/index.js) so the logic lives in exactly one place.

  Every handler takes (env, input) and returns { status, body }. `env` is
  process.env locally and the Worker's `env` binding in production. Uses only
  Web-standard APIs (global fetch, global crypto) so it runs on Workers.
*/
import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk'
import { sendPush, pushConfigured } from './webpush.mjs'

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
  return { token: await at.toJwt(), identity }
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

async function mergeRoomFlags(roomService, room, patch) {
  const current = await getRoomFlags(roomService, room)
  await roomService.updateRoomMetadata(room, JSON.stringify({ ...current, ...patch }))
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

// Resolve the caller's TRUSTED account id from their Supabase session token, the
// same way handlePushRing proves contact authorization. The client sends whatever
// it likes for `userId` at knock; trusting that lets a participant claim another
// user's id (and force-disconnect them via handoff). So we IGNORE the client value
// and derive the id server-side: a valid Supabase access token → the verified uid;
// no/invalid token → '' (an unauthenticated guest, who is device-bound anyway).
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
    return u?.id || null
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
async function ensureHost(env, roomService, room, token) {
  const identity = await verifyCaller(env, token, room)
  if (!identity) return false
  const flags = await getRoomFlags(roomService, room)
  // The primary host OR a promoted co-host. Co-hosts pass moderation/admit
  // checks; the server performs the privileged action with its own admin creds,
  // so co-hosts never need roomAdmin in their own join token.
  if (Boolean(flags.hostId) && flags.hostId === identity) return true
  return Array.isArray(flags.coHosts) && flags.coHosts.includes(identity)
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
    },
  }
}

export async function handleKnock(env, body) {
  const { apiKey, apiSecret, roomService } = services(env)
  const { room, name, deviceId, host, accessToken, secret } = body ?? {}
  if (!room || !name) return { status: 400, body: { error: 'room and name are required' } }
  if (!apiKey || !apiSecret) return { status: 500, body: { error: 'LIVEKIT keys not set' } }

  const identity = `${name}#${deviceId || 'web'}`
  // SERVER-DERIVED account id — never the client-supplied `userId` (which a client
  // can set to any value, including a victim's, to spoof identity in handoff). A
  // valid Supabase session → the verified uid; otherwise '' (guest).
  const userId = (await verifySupabaseUser(env, accessToken)) || ''

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
  const flags = await getRoomFlags(roomService, room)
  const participants = await listParticipants(roomService, room)
  const alreadyIn = participants.some((p) => p.identity === identity)
  const isHost = identity === flags.hostId || (participants.length === 0 && !flags.hostId)
  const queue = Array.isArray(flags.queue) ? flags.queue : []
  // Already admitted this session? Someone the host let in, who then left, should
  // walk straight back in rather than re-queueing in the lobby (the "can't rejoin
  // after being allowed in" bug). Match on the stable name+device identity.
  const wasApproved = queue.some(
    (e) => e.name === name && (e.deviceId || '') === (deviceId || '') && e.status === 'approved',
  )

  if (!isHost && !alreadyIn && flags.locked) {
    return { status: 403, body: { error: 'This room is locked by the host.' } }
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
      return { status: 403, body: { error: 'This room needs its invite link — open the full link you were sent.' } }
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
          await roomService.createRoom({ name: room, metadata: JSON.stringify(patch) })
        } catch {
          /* non-fatal: host UI/moderation degrades, joining still works */
        }
      }
    }
    const minted = await mintToken(env, room, name, deviceId, isHost, userId)
    return { status: 200, body: { ...minted, host: isHost } }
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
    return { status: 503, body: { error: 'The host isn’t here to let you in yet — try again in a moment.' } }
  }

  const now = Date.now()
  const requestId = crypto.randomUUID()
  // Prune stale pending entries (past the TTL) BEFORE the 50-cap, so a burst of
  // dead knocks can't evict fresh ones — the earlier-pending-evicted-as-expired
  // bug — and the queue self-cleans. Resolved entries are kept (rejoin needs them).
  const live = queue.filter((e) => e.status !== 'pending' || now - (e.ts || now) < KNOCK_TTL_MS)
  live.push({ id: requestId, name, deviceId, userId: userId || '', status: 'pending', ts: now })
  await mergeRoomFlags(roomService, room, { queue: live.slice(-50) })
  return { status: 200, body: { pending: true, requestId } }
}

export async function handleKnockStatus(env, query) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { status: 'expired' } }
  const { room, requestId } = query
  const flags = await getRoomFlags(roomService, room)
  const entry = (Array.isArray(flags.queue) ? flags.queue : []).find((e) => e.id === requestId)
  if (!entry) return { status: 200, body: { status: 'expired' } }
  // A pending entry past its TTL is treated as expired — the host never actioned
  // it (left / missed the prompt), so stop the guest polling forever.
  if (entry.status === 'pending' && entry.ts && Date.now() - entry.ts > KNOCK_TTL_MS) {
    return { status: 200, body: { status: 'expired' } }
  }
  if (entry.status === 'approved') {
    const minted = await mintToken(env, room, entry.name, entry.deviceId, false, entry.userId)
    return { status: 200, body: { status: 'approved', ...minted } }
  }
  return { status: 200, body: { status: entry.status } }
}

export async function handlePending(env, query, token) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { pending: [] } }
  const { room } = query
  if (!(await ensureHost(env, roomService, room, token))) return { status: 403, body: { error: 'host only' } }
  const flags = await getRoomFlags(roomService, room)
  const pending = (Array.isArray(flags.queue) ? flags.queue : [])
    .filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name }))
  return { status: 200, body: { pending } }
}

export async function handleAdmit(env, body, token) {
  const { roomService } = services(env)
  const { room, requestId, approve } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!(await ensureHost(env, roomService, room, token))) return { status: 403, body: { error: 'host only' } }
  const flags = await getRoomFlags(roomService, room)
  const queue = Array.isArray(flags.queue) ? flags.queue : []
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return { status: 404, body: { error: 'request not found' } }
  entry.status = approve ? 'approved' : 'denied'
  await mergeRoomFlags(roomService, room, { queue })
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
  if (!(await ensureHost(env, roomService, room, token))) return { status: 403, body: { error: 'host only' } }
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

  const flags = await getRoomFlags(roomService, room)
  const participants = await listParticipants(roomService, room)
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

  // The new primary shouldn't also sit in its own co-host list.
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
  const { room, locked, waiting, coHosts } = body ?? {}
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
  await mergeRoomFlags(roomService, room, patch)
  return { status: 200, body: { ok: true, ...patch } }
}

export async function handleEmailInvite(env, body, token) {
  const { to, room, link, fromName } = body ?? {}
  if (!to || !link) return { status: 400, body: { error: 'to and link required' } }
  // Require a valid join token for the room being invited to. Without this the
  // endpoint is an open relay: anyone could make our verified Resend domain send
  // "X invited you to a Manim call" to arbitrary addresses (spam / reputation
  // burn). The token is the same signed LiveKit token the inviter holds in-call,
  // bound to this room (verifyCaller rejects a token minted for another room).
  if (!room) return { status: 400, body: { error: 'room required' } }
  if (!(await verifyCaller(env, token, room))) {
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
  const key = env.RESEND_API_KEY
  if (!key) return { status: 501, body: { error: 'email not configured' } }
  const from = env.RESEND_FROM || 'Manim <onboarding@resend.dev>'
  // All interpolated values are escaped — they come from the client.
  const who = escapeHtml(fromName || 'Someone')
  const safeRoom = room ? escapeHtml(room) : ''
  const href = escapeHtml(url.href)
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [String(to)],
      subject: `${who} invited you to a Manim call`,
      html: `<p>${who} invited you to join a Manim call${safeRoom ? ` (room <b>${safeRoom}</b>)` : ''}.</p>
             <p><a href="${href}">Join the call</a></p><p style="color:#888">${href}</p>`,
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
      } catch {
        /* one dead endpoint shouldn't fail the others */
      }
    }),
  )
  return { status: 200, body: { ok: true, sent } }
}
