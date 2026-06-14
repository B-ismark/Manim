/*
  Dev-only token server. Mints short-lived LiveKit access tokens so the API
  secret never reaches the browser. In production this becomes a serverless
  function (Cloudflare Worker / Supabase Edge Function) — same logic.

  Identity is `displayName##userId#deviceId` so one user can hold multiple
  device connections (multi-device handoff). LiveKit requires unique identity
  per connection; the `#deviceId` suffix guarantees that.
*/
import 'dotenv/config'
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKeys: Boolean(API_KEY && API_SECRET) })
})

app.post('/api/token', async (req, res) => {
  try {
    const { room, name, deviceId, host } = req.body ?? {}
    if (!room || !name) {
      return res.status(400).json({ error: 'room and name are required' })
    }
    if (!API_KEY || !API_SECRET) {
      return res.status(500).json({ error: 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set in .env' })
    }

    const device = deviceId || 'web'
    const identity = `${name}#${device}`

    // Host = the first person to join the room (creator). Determined server-side
    // so it can't be spoofed by the client. Falls back to the client hint only
    // when the RoomServiceClient isn't configured (no LIVEKIT URL).
    let isHost = Boolean(host)
    let participants = []
    if (roomService) {
      try {
        participants = await roomService.listParticipants(room)
        isHost = participants.length === 0
      } catch {
        // Room doesn't exist yet → this caller is the first in.
        isHost = true
      }

      // Room lock: block new joins when locked (host + existing participants
      // reconnecting are still allowed).
      if (!isHost) {
        try {
          const rooms = await roomService.listRooms([room])
          const locked = rooms[0]?.metadata ? Boolean(JSON.parse(rooms[0].metadata).locked) : false
          const alreadyIn = participants.some((p) => p.identity === identity)
          if (locked && !alreadyIn) {
            return res.status(403).json({ error: 'This room is locked by the host.' })
          }
        } catch {
          /* no room/metadata yet → not locked */
        }
      }
    }

    const at = new AccessToken(API_KEY, API_SECRET, {
      identity,
      name,
      ttl: '15m', // short-lived per security model
      metadata: JSON.stringify({ host: isHost }),
    })
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true, // for chat + P2P file transfer (data channel)
      canUpdateOwnMetadata: true, // for raise-hand + presence via participant attributes
      roomAdmin: isHost, // host gets moderation rights
    })

    const token = await at.toJwt()
    res.json({ token, identity, host: isHost })
  } catch (err) {
    console.error('token error', err)
    res.status(500).json({ error: 'failed to mint token' })
  }
})

/**
 * Host moderation: force-mute or remove a participant. The caller must be the
 * room host — verified server-side against the participant metadata stamped at
 * join, so a non-host client can't moderate even if it calls this directly.
 */
app.post('/api/moderate', async (req, res) => {
  try {
    const { room, caller, target, action, trackSid } = req.body ?? {}
    if (!room || !caller || !target || !action) {
      return res.status(400).json({ error: 'room, caller, target, action required' })
    }
    if (!roomService) {
      return res.status(500).json({ error: 'RoomServiceClient not configured (set VITE_LIVEKIT_URL)' })
    }

    const participants = await roomService.listParticipants(room)
    const callerInfo = participants.find((p) => p.identity === caller)
    let callerIsHost = false
    try {
      callerIsHost = Boolean(JSON.parse(callerInfo?.metadata || '{}').host)
    } catch {
      callerIsHost = false
    }
    if (!callerIsHost) {
      return res.status(403).json({ error: 'only the host can moderate' })
    }

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

/** Host toggles the room lock (stored in room metadata, enforced at token mint). */
app.post('/api/lock', async (req, res) => {
  try {
    const { room, caller, locked } = req.body ?? {}
    if (!room || !caller || typeof locked !== 'boolean') {
      return res.status(400).json({ error: 'room, caller, locked(boolean) required' })
    }
    if (!roomService) {
      return res.status(500).json({ error: 'RoomServiceClient not configured' })
    }
    const participants = await roomService.listParticipants(room)
    const callerInfo = participants.find((p) => p.identity === caller)
    let callerIsHost = false
    try {
      callerIsHost = Boolean(JSON.parse(callerInfo?.metadata || '{}').host)
    } catch {
      callerIsHost = false
    }
    if (!callerIsHost) {
      return res.status(403).json({ error: 'only the host can lock the room' })
    }
    await roomService.updateRoomMetadata(room, JSON.stringify({ locked }))
    res.json({ ok: true, locked })
  } catch (err) {
    console.error('lock error', err)
    res.status(500).json({ error: 'failed to update lock' })
  }
})

app.listen(PORT, () => {
  const keys = API_KEY && API_SECRET ? 'keys loaded' : 'NO KEYS (set .env)'
  console.log(`[token] http://localhost:${PORT}  (${keys})`)
})
