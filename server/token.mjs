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
    if (roomService) {
      try {
        const participants = await roomService.listParticipants(room)
        isHost = participants.length === 0
      } catch {
        // Room doesn't exist yet → this caller is the first in.
        isHost = true
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

app.listen(PORT, () => {
  const keys = API_KEY && API_SECRET ? 'keys loaded' : 'NO KEYS (set .env)'
  console.log(`[token] http://localhost:${PORT}  (${keys})`)
})
