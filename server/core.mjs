/*
  Orchestration core — pure, env-injected, runtime-agnostic. Shared by the local
  Express dev server (server/token.mjs) and the Cloudflare Worker
  (worker/index.js) so the logic lives in exactly one place.

  Every handler takes (env, input) and returns { status, body }. `env` is
  process.env locally and the Worker's `env` binding in production. Uses only
  Web-standard APIs (global fetch, global crypto) so it runs on Workers.
*/
import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk'

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escape user-supplied text before interpolating into email HTML. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c])
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const { room, name, deviceId, userId, host } = body ?? {}
  if (!room || !name) return { status: 400, body: { error: 'room and name are required' } }
  if (!apiKey || !apiSecret) return { status: 500, body: { error: 'LIVEKIT keys not set' } }

  const identity = `${name}#${deviceId || 'web'}`

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

  if (!isHost && !alreadyIn && flags.locked) {
    return { status: 403, body: { error: 'This room is locked by the host.' } }
  }

  if (isHost || alreadyIn || !flags.waiting) {
    // Record the authoritative host identity ONCE (only when unclaimed), server-side,
    // so it can't be forged via participant metadata (see ensureHost) and a second
    // simultaneous first-join can't overwrite it. At first-join the room doesn't
    // exist yet, so updateRoomMetadata would fail — create it with the metadata
    // instead. (LiveKit auto-creates the room on connect either way.)
    if (isHost && !flags.hostId) {
      try {
        await mergeRoomFlags(roomService, room, { hostId: identity })
      } catch {
        try {
          await roomService.createRoom({ name: room, metadata: JSON.stringify({ hostId: identity }) })
        } catch {
          /* non-fatal: host UI/moderation degrades, joining still works */
        }
      }
    }
    const minted = await mintToken(env, room, name, deviceId, isHost, userId)
    return { status: 200, body: { ...minted, host: isHost } }
  }

  const requestId = crypto.randomUUID()
  const queue = Array.isArray(flags.queue) ? flags.queue : []
  queue.push({ id: requestId, name, deviceId, userId: userId || '', status: 'pending' })
  await mergeRoomFlags(roomService, room, { queue: queue.slice(-50) })
  return { status: 200, body: { pending: true, requestId } }
}

export async function handleKnockStatus(env, query) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { status: 'expired' } }
  const { room, requestId } = query
  const flags = await getRoomFlags(roomService, room)
  const entry = (Array.isArray(flags.queue) ? flags.queue : []).find((e) => e.id === requestId)
  if (!entry) return { status: 200, body: { status: 'expired' } }
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

export async function handleModerate(env, body, token) {
  const { roomService } = services(env)
  const { room, target, action, trackSid, source } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room || !target || !action) return { status: 400, body: { error: 'missing fields' } }
  const modIdentity = await verifyCaller(env, token, room)
  if (!modIdentity) return { status: 401, body: { error: 'Your session expired — rejoin to moderate.' } }
  const modFlags = await getRoomFlags(roomService, room)
  const modIsHost =
    modFlags.hostId === modIdentity ||
    (Array.isArray(modFlags.coHosts) && modFlags.coHosts.includes(modIdentity))
  if (!modIsHost) return { status: 403, body: { error: 'Host only.' } }
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

export async function handleEmailInvite(env, body) {
  const { to, room, link, fromName } = body ?? {}
  if (!to || !link) return { status: 400, body: { error: 'to and link required' } }
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
