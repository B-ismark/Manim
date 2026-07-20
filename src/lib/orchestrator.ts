/*
  Client side of the session orchestrator. Talks to the dev token server today;
  the same calls map onto a serverless function in production. One import site
  for join (knock), waiting-room admit, moderation, and room flags.
*/

/** An error carrying the server's HTTP status + machine-readable `code`, so callers
 *  can branch on a specific failure (e.g. an expired link) instead of string-matching
 *  the human message. */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // Host endpoints authenticate by the caller's signed LiveKit token (Bearer),
  // verified server-side — not a plaintext identity (which any participant can read).
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
    throw new ApiError(data.error ?? `request failed (${res.status})`, res.status, data.code)
  }
  return (await res.json()) as T
}

export interface JoinRequest {
  room: string
  name: string
  deviceId: string
  /** Supabase access token, if signed in. The server derives the stamped account
   *  id FROM this (verified) — it ignores any client-claimed `userId`, so a client
   *  can't spoof another user's identity. Absent for guests (stamped id = ''). */
  accessToken?: string
  /** Join secret from the invite link's #fragment. Required by the server once a
   *  room records its hash; absent for open (typed-name) rooms. */
  secret?: string
  host?: boolean
}

export interface KnockResponse {
  /** Present when admitted immediately (host, existing participant, or no waiting room). */
  token?: string
  identity?: string
  host?: boolean
  /** True when the SAME signed-in account is already in the room on another device.
   *  Lets prejoin offer "join anyway (companion, muted)" vs "transfer to this device". */
  alsoOnDevice?: boolean
  /** Present when the waiting room queued the request for host approval. */
  pending?: boolean
  requestId?: string
}

/** Request to join. May return a token directly or a pending knock. */
export function knock(req: JoinRequest): Promise<KnockResponse> {
  return postJson<KnockResponse>('/api/knock', req)
}

export interface KnockStatus {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  token?: string
  identity?: string
}

/** Poll the host's decision on a queued knock. */
export async function knockStatus(room: string, requestId: string): Promise<KnockStatus> {
  const res = await fetch(`/api/knock-status?room=${encodeURIComponent(room)}&requestId=${requestId}`)
  if (!res.ok) return { status: 'expired' }
  return (await res.json()) as KnockStatus
}

export interface PendingKnocker {
  id: string
  name: string
}

/** Host: list people waiting to be admitted. `token` is the host's signed join token. */
export async function listPending(room: string, token: string): Promise<PendingKnocker[]> {
  const res = await fetch(`/api/pending?room=${encodeURIComponent(room)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) return []
  const data = (await res.json()) as { pending?: PendingKnocker[] }
  return data.pending ?? []
}

/** Host: admit or deny a waiting knocker. `token` is the host's signed join token. */
export function admit(
  room: string,
  token: string,
  requestId: string,
  approve: boolean,
): Promise<{ ok: boolean }> {
  return postJson('/api/admit', { room, requestId, approve }, token)
}

export interface ModerateRequest {
  room: string
  /** The host's signed LiveKit join token — proves host authority server-side. */
  token: string
  /** Identity of the participant being moderated. */
  target: string
  action: 'mute' | 'remove'
  /** Required for `mute` — the track to silence. */
  trackSid?: string
  /** Track source for `mute` — lets the server resolve the *current* sid (so a
   *  re-mute after the target self-unmutes targets the live track, not a stale sid). */
  source?: 'microphone' | 'camera'
}

export function moderate({ token, ...body }: ModerateRequest): Promise<void> {
  return postJson<{ ok: boolean }>('/api/moderate', body, token).then(() => undefined)
}

export interface RoomFlagsRequest {
  room: string
  /** The host's signed LiveKit join token — proves host authority server-side. */
  token: string
  locked?: boolean
  waiting?: boolean
  /** Co-host identities. Only the primary host may change this (server-enforced). */
  coHosts?: string[]
}

/** Host: set room flags (lock / waiting room / co-hosts). */
export function setRoomFlags({ token, ...body }: RoomFlagsRequest): Promise<void> {
  return postJson<{ ok: boolean }>('/api/roomflags', body, token).then(() => undefined)
}

/**
 * Host: end the call for everyone, server-side (deletes the LiveKit room). This is
 * the authoritative close — it disconnects participants the data-channel `end`
 * broadcast can't reach (anyone mid-reconnect) and blocks rejoins. `token` is the
 * host's signed join token.
 */
export function endRoom(room: string, token: string): Promise<void> {
  return postJson<{ ok: boolean }>('/api/end', { room }, token).then(() => undefined)
}

/**
 * Promote a successor host when the primary has left (the recorded hostId is no
 * longer in the room). Any remaining participant may call it; the server only acts
 * if the host is genuinely absent and picks the successor deterministically, so
 * concurrent calls from every client are safe + idempotent. Returns the (possibly
 * unchanged) hostId. `token` is the caller's signed join token.
 */
export function electHost(room: string, token: string): Promise<{ ok: boolean; hostId: string }> {
  return postJson<{ ok: boolean; hostId: string }>('/api/elect-host', { room }, token)
}

/**
 * Multi-device handoff: drop the caller's own OTHER sessions in this room, keeping
 * `keepDevice`. Server-mediated and authorized on the caller's signed-token account
 * id — NOT a client broadcast (which could be forged to disconnect anyone). `token`
 * is the caller's signed join token.
 */
export function handoff(room: string, token: string, keepDevice: string): Promise<void> {
  return postJson<{ ok: boolean }>('/api/handoff', { room, keepDevice }, token).then(() => undefined)
}

/**
 * Send a real email invite (Resend). Resolves true if sent; false on ANY
 * failure — not configured (501) OR the provider rejected it (502, e.g. an
 * unverified sandbox recipient). Either way the caller falls back to mailto, so
 * an invite never silently drops. Only a network error rejects the promise.
 */
export async function sendEmailInvite(
  to: string,
  room: string,
  link: string,
  fromName: string,
  /** The inviter's signed join token — the server requires it so the endpoint
   *  can't be used as an open spam relay. Falls back to mailto when absent/invalid. */
  token?: string,
): Promise<boolean> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch('/api/email-invite', {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, room, link, fromName }),
  })
  return res.ok
}

export const LIVEKIT_URL: string = import.meta.env.VITE_LIVEKIT_URL ?? ''

export interface ServerHealth {
  ok: boolean
  /** LiveKit API key + secret present on the Worker (calls can mint tokens). */
  hasKeys: boolean
  /** RESEND_API_KEY present (real email invites; else mailto fallback). */
  email: boolean
  /** Beta allowlist gate is on — only approved accounts can start a call. */
  betaGate: boolean
}

/** Probe server-side capabilities for the setup-status surface. Never throws. */
export async function getHealth(): Promise<ServerHealth> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { ok: false, hasKeys: false, email: false, betaGate: false }
    return (await res.json()) as ServerHealth
  } catch {
    return { ok: false, hasKeys: false, email: false, betaGate: false }
  }
}

export interface MeStatus {
  /** Server verified a Supabase session from the supplied token. */
  signedIn: boolean
  /** Beta allowlist gate is on. */
  betaGate: boolean
  /** This user may START a call (gate off, or their email is allowlisted). */
  allowed: boolean
}

/** Whether the current user can host, per the beta gate. `accessToken` is the
 *  Supabase session token (absent for guests). Never throws — defaults to a
 *  signed-out, gate-off view so the UI degrades to "open" if the probe fails. */
export async function getMe(accessToken?: string): Promise<MeStatus> {
  try {
    const res = await fetch('/api/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    })
    if (!res.ok) return { signedIn: false, betaGate: false, allowed: true }
    return (await res.json()) as MeStatus
  } catch {
    return { signedIn: false, betaGate: false, allowed: true }
  }
}
