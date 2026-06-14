/*
  Dev-only token + session server. Mints short-lived LiveKit access tokens so
  the API secret never reaches the browser, and runs the lightweight session
  orchestration (host detection, lock, moderation, waiting room).

  In production this becomes a serverless function (Cloudflare Worker / Supabase
  Edge Function) and the in-memory waiting-room store moves to a shared store
  (Supabase) — same logic.

  Identity is `name#deviceId` so one user can hold multiple device connections
  (multi-device handoff). LiveKit requires a unique identity per connection.
*/
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'

const PORT = process.env.TOKEN_SERVER_PORT || 3001
const API_KEY = process.env.LIVEKIT_API_KEY
const API_SECRET = process.env.LIVEKIT_API_SECRET

// RoomServiceClient needs the https(s) host (the same project URL, ws→http).
const LK_HOST = (process.env.VITE_LIVEKIT_URL || '').replace(/^ws/, 'http')
const roomService =
  LK_HOST && API_KEY && API_SECRET ? new RoomServiceClient(LK_HOST, API_KEY, API_SECRET) : null

const app = express()
app.use(cors())
app.use(express.json())

// ── Helpers ────────────────────────────────────────────────────────────────

async function mintToken(room, name, deviceId, isHost, userId) {
  const identity = `${name}#${deviceId || 'web'}`
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name,
    ttl: '15m', // short-lived per security model
    metadata: JSON.stringify({ host: isHost, userId: userId || '' }),
  })
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // chat + P2P file transfer (data channel)
    canUpdateOwnMetadata: true, // raise-hand + presence via participant attributes
    roomAdmin: isHost, // host gets moderation rights
  })
  return { token: await at.toJwt(), identity }
}

async function listParticipants(room) {
  try {
    return await roomService.listParticipants(room)
  } catch {
    return []
  }
}

async function getRoomFlags(room) {
  try {
    const rooms = await roomService.listRooms([room])
    return rooms[0]?.metadata ? JSON.parse(rooms[0].metadata) : {}
  } catch {
    return {}
  }
}

/** Merge a patch into the room metadata (preserves other flags). */
async function mergeRoomFlags(room, patch) {
  const current = await getRoomFlags(room)
  await roomService.updateRoomMetadata(room, JSON.stringify({ ...current, ...patch }))
}

function isHostParticipant(participants, identity) {
  const info = participants.find((p) => p.identity === identity)
  try {
    return Boolean(JSON.parse(info?.metadata || '{}').host)
  } catch {
    return false
  }
}

async function requireHost(req, res) {
  const { room, caller } = req.body ?? {}
  if (!room || !caller) {
    res.status(400).json({ error: 'room and caller required' })
    return false
  }
  if (!roomService) {
    res.status(500).json({ error: 'RoomServiceClient not configured (set VITE_LIVEKIT_URL)' })
    return false
  }
  const participants = await listParticipants(room)
  if (!isHostParticipant(participants, caller)) {
    res.status(403).json({ error: 'host only' })
    return false
  }
  return true
}

// Waiting room is stored in the room metadata `queue` (stateless → serverless-
// ready). Tokens are minted on approval read, never stored.
async function readQueue(room) {
  const flags = await getRoomFlags(room)
  return Array.isArray(flags.queue) ? flags.queue : []
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKeys: Boolean(API_KEY && API_SECRET) })
})

/**
 * Join request. Returns a token directly for the host, existing participants,
 * and normal rooms; enforces lock; and queues a knock when the waiting room is on.
 */
app.post('/api/knock', async (req, res) => {
  try {
    const { room, name, deviceId, userId } = req.body ?? {}
    if (!room || !name) return res.status(400).json({ error: 'room and name are required' })
    if (!API_KEY || !API_SECRET) {
      return res.status(500).json({ error: 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set in .env' })
    }

    const identity = `${name}#${deviceId || 'web'}`

    if (!roomService) {
      // No orchestration available → mint directly (host hint from client).
      const minted = await mintToken(room, name, deviceId, Boolean(req.body.host), userId)
      return res.json({ ...minted, host: Boolean(req.body.host) })
    }

    const participants = await listParticipants(room)
    const isHost = participants.length === 0
    const alreadyIn = participants.some((p) => p.identity === identity)
    const flags = await getRoomFlags(room)

    if (!isHost && !alreadyIn && flags.locked) {
      return res.status(403).json({ error: 'This room is locked by the host.' })
    }

    if (isHost || alreadyIn || !flags.waiting) {
      const minted = await mintToken(room, name, deviceId, isHost, userId)
      return res.json({ ...minted, host: isHost })
    }

    // Waiting room on → queue a knock for host approval (stored in metadata).
    const requestId = randomUUID()
    const queue = Array.isArray(flags.queue) ? flags.queue : []
    queue.push({ id: requestId, name, deviceId, userId: userId || '', status: 'pending' })
    await mergeRoomFlags(room, { queue: queue.slice(-50) })
    res.json({ pending: true, requestId })
  } catch (err) {
    console.error('knock error', err)
    res.status(500).json({ error: 'failed to join' })
  }
})

/** Knocker polls for the host's decision. Token is minted fresh on approval. */
app.get('/api/knock-status', async (req, res) => {
  if (!roomService) return res.json({ status: 'expired' })
  const { room, requestId } = req.query
  const entry = (await readQueue(room)).find((e) => e.id === requestId)
  if (!entry) return res.json({ status: 'expired' })
  if (entry.status === 'approved') {
    const minted = await mintToken(room, entry.name, entry.deviceId, false, entry.userId)
    return res.json({ status: 'approved', ...minted })
  }
  res.json({ status: entry.status })
})

/** Host lists pending knockers. */
app.get('/api/pending', async (req, res) => {
  const { room, caller } = req.query
  if (!roomService) return res.json({ pending: [] })
  const participants = await listParticipants(room)
  if (!isHostParticipant(participants, caller)) return res.status(403).json({ error: 'host only' })
  const pending = (await readQueue(room))
    .filter((e) => e.status === 'pending')
    .map((e) => ({ id: e.id, name: e.name }))
  res.json({ pending })
})

/** Host admits or denies a knocker (updates the metadata queue). */
app.post('/api/admit', async (req, res) => {
  if (!(await requireHost(req, res))) return
  const { room, requestId, approve } = req.body ?? {}
  const queue = await readQueue(room)
  const entry = queue.find((e) => e.id === requestId)
  if (!entry) return res.status(404).json({ error: 'request not found' })
  entry.status = approve ? 'approved' : 'denied'
  await mergeRoomFlags(room, { queue })
  res.json({ ok: true })
})

/** Host moderation: force-mute or remove a participant (host-verified). */
app.post('/api/moderate', async (req, res) => {
  try {
    if (!(await requireHost(req, res))) return
    const { room, target, action, trackSid } = req.body ?? {}
    if (!target || !action) return res.status(400).json({ error: 'target and action required' })

    if (action === 'remove') {
      await roomService.removeParticipant(room, target)
    } else if (action === 'mute') {
      if (!trackSid) return res.status(400).json({ error: 'trackSid required to mute' })
      await roomService.mutePublishedTrack(room, target, trackSid, true)
    } else {
      return res.status(400).json({ error: 'unknown action' })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('moderate error', err)
    res.status(500).json({ error: 'moderation failed' })
  }
})

/** Host toggles room flags (lock / waiting). Stored in room metadata. */
app.post('/api/roomflags', async (req, res) => {
  try {
    if (!(await requireHost(req, res))) return
    const { room, locked, waiting: waitingFlag } = req.body ?? {}
    const patch = {}
    if (typeof locked === 'boolean') patch.locked = locked
    if (typeof waitingFlag === 'boolean') patch.waiting = waitingFlag
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'nothing to update' })
    }
    await mergeRoomFlags(room, patch)
    res.json({ ok: true, ...patch })
  } catch (err) {
    console.error('roomflags error', err)
    res.status(500).json({ error: 'failed to update room flags' })
  }
})

app.listen(PORT, () => {
  const keys = API_KEY && API_SECRET ? 'keys loaded' : 'NO KEYS (set .env)'
  console.log(`[token] http://localhost:${PORT}  (${keys})`)
})
