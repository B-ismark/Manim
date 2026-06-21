/*
  Local dev server — a thin Express wrapper over the shared orchestration core
  (server/core.mjs). Production runs the SAME core via a Cloudflare Pages
  Function (functions/api/[[path]].ts). Keep logic in core.mjs, not here.
*/
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  handleHealth,
  handleMe,
  handleKnock,
  handleKnockStatus,
  handlePending,
  handleAdmit,
  handleEndRoom,
  handleElectHost,
  handleHandoff,
  handleModerate,
  handleRoomflags,
  handleEmailInvite,
  handlePushRing,
} from './core.mjs'

const PORT = process.env.TOKEN_SERVER_PORT || 3001
const app = express()
app.use(cors())
app.use(express.json())

const send = (res, r) => res.status(r.status).json(r.body)
const env = process.env

// Bearer token = the caller's signed LiveKit join token; host endpoints verify it.
const bearer = (req) => (req.get('authorization') || '').replace(/^Bearer\s+/i, '')

app.get('/api/health', (_req, res) => send(res, handleHealth(env)))
app.post('/api/me', async (req, res) => send(res, await handleMe(env, req.body)))
app.post('/api/knock', async (req, res) => send(res, await handleKnock(env, req.body)))
app.get('/api/knock-status', async (req, res) => send(res, await handleKnockStatus(env, req.query)))
app.get('/api/pending', async (req, res) => send(res, await handlePending(env, req.query, bearer(req))))
app.post('/api/admit', async (req, res) => send(res, await handleAdmit(env, req.body, bearer(req))))
app.post('/api/end', async (req, res) => send(res, await handleEndRoom(env, req.body, bearer(req))))
app.post('/api/elect-host', async (req, res) => send(res, await handleElectHost(env, req.body, bearer(req))))
app.post('/api/handoff', async (req, res) => send(res, await handleHandoff(env, req.body, bearer(req))))
app.post('/api/moderate', async (req, res) => send(res, await handleModerate(env, req.body, bearer(req))))
app.post('/api/roomflags', async (req, res) => send(res, await handleRoomflags(env, req.body, bearer(req))))
app.post('/api/email-invite', async (req, res) => send(res, await handleEmailInvite(env, req.body, bearer(req))))
app.post('/api/push', async (req, res) => send(res, await handlePushRing(env, req.body)))

app.listen(PORT, () => {
  const keys = env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET ? 'keys loaded' : 'NO KEYS (set .env)'
  console.log(`[token] http://localhost:${PORT}  (${keys})`)
})
