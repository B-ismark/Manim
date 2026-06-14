/*
  Orchestration core — pure, env-injected, runtime-agnostic. Shared by the local
  Express dev server (server/token.mjs) and the Cloudflare Worker
  (worker/index.js) so the logic lives in exactly one place.

  Every handler takes (env, input) and returns { status, body }. `env` is
  process.env locally and the Worker's `env` binding in production. Uses only
  Web-standard APIs (global fetch, global crypto) so it runs on Workers.
*/
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'

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

// Host authority lives in ROOM metadata (written only by the server / a roomAdmin
// token), NOT participant metadata: tokens grant canUpdateOwnMetadata (needed for
// raise-hand attributes), so a participant could otherwise rewrite their own
// metadata to {host:true} and self-promote. Room metadata is unforgeable by
// non-host participants (they have roomAdmin:false).
async function ensureHost(roomService, room, caller) {
  const flags = await getRoomFlags(roomService, room)
  return Boolean(flags.hostId) && flags.hostId === caller
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
    const minted = await mintToken(env, room, name, deviceId, Boolean(host), userId)
    return { status: 200, body: { ...minted, host: Boolean(host) } }
  }

  const participants = await listParticipants(roomService, room)
  const isHost = participants.length === 0
  const alreadyIn = participants.some((p) => p.identity === identity)
  const flags = await getRoomFlags(roomService, room)

  if (!isHost && !alreadyIn && flags.locked) {
    return { status: 403, body: { error: 'This room is locked by the host.' } }
  }

  if (isHost || alreadyIn || !flags.waiting) {
    // Record the authoritative host identity once, server-side, so it can't be
    // forged via participant metadata (see ensureHost). At first-join the room
    // doesn't exist yet, so updateRoomMetadata would fail — create it with the
    // metadata instead. (LiveKit auto-creates the room on connect either way.)
    if (isHost && flags.hostId !== identity) {
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

export async function handlePending(env, query) {
  const { roomService } = services(env)
  if (!roomService) return { status: 200, body: { pending: [] } }
  const { room, caller } = query
  if (!(await ensureHost(roomService, room, caller))) return { status: 403, body: { error: 'host only' } }
  const flags = await getRoomFlags(roomService, room)
  const pending = (Array.isArray(flags.queue) ? flags.queue : [])
    .filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name }))
  return { status: 200, body: { pending } }
}

export async function handleAdmit(env, body) {
  const { roomService } = services(env)
  const { room, caller, requestId, approve } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!(await ensureHost(roomService, room, caller))) return { status: 403, body: { error: 'host only' } }
  const flags = await getRoomFlags(roomService, room)
  const queue = Array.isArray(flags.queue) ? flags.queue : []
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return { status: 404, body: { error: 'request not found' } }
  entry.status = approve ? 'approved' : 'denied'
  await mergeRoomFlags(roomService, room, { queue })
  return { status: 200, body: { ok: true } }
}

export async function handleModerate(env, body) {
  const { roomService } = services(env)
  const { room, caller, target, action, trackSid } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!room || !caller || !target || !action) return { status: 400, body: { error: 'missing fields' } }
  if (!(await ensureHost(roomService, room, caller))) return { status: 403, body: { error: 'host only' } }
  if (action === 'remove') {
    await roomService.removeParticipant(room, target)
  } else if (action === 'mute') {
    if (!trackSid) return { status: 400, body: { error: 'trackSid required' } }
    await roomService.mutePublishedTrack(room, target, trackSid, true)
  } else {
    return { status: 400, body: { error: 'unknown action' } }
  }
  return { status: 200, body: { ok: true } }
}

export async function handleRoomflags(env, body) {
  const { roomService } = services(env)
  const { room, caller, locked, waiting } = body ?? {}
  if (!roomService) return { status: 500, body: { error: 'not configured' } }
  if (!(await ensureHost(roomService, room, caller))) return { status: 403, body: { error: 'host only' } }
  const patch = {}
  if (typeof locked === 'boolean') patch.locked = locked
  if (typeof waiting === 'boolean') patch.waiting = waiting
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
