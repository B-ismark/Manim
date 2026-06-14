/*
  Client side of the session orchestrator. Talks to the dev token server today;
  the same calls map onto a serverless function in production. One import site
  for join (knock), waiting-room admit, moderation, and room flags.
*/

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `request failed (${res.status})`)
  }
  return (await res.json()) as T
}

export interface JoinRequest {
  room: string
  name: string
  deviceId: string
  /** Stable account/guest id — stamped into metadata for presence + handoff. */
  userId?: string
  host?: boolean
}

export interface KnockResponse {
  /** Present when admitted immediately (host, existing participant, or no waiting room). */
  token?: string
  identity?: string
  host?: boolean
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

/** Host: list people waiting to be admitted. */
export async function listPending(room: string, caller: string): Promise<PendingKnocker[]> {
  const res = await fetch(
    `/api/pending?room=${encodeURIComponent(room)}&caller=${encodeURIComponent(caller)}`,
  )
  if (!res.ok) return []
  const data = (await res.json()) as { pending?: PendingKnocker[] }
  return data.pending ?? []
}

/** Host: admit or deny a waiting knocker. */
export function admit(
  room: string,
  caller: string,
  requestId: string,
  approve: boolean,
): Promise<{ ok: boolean }> {
  return postJson('/api/admit', { room, caller, requestId, approve })
}

export interface ModerateRequest {
  room: string
  /** Identity of the host making the request (verified server-side). */
  caller: string
  /** Identity of the participant being moderated. */
  target: string
  action: 'mute' | 'remove'
  /** Required for `mute` — the track to silence. */
  trackSid?: string
}

export function moderate(req: ModerateRequest): Promise<void> {
  return postJson<{ ok: boolean }>('/api/moderate', req).then(() => undefined)
}

export interface RoomFlagsRequest {
  room: string
  /** Host identity (verified server-side). */
  caller: string
  locked?: boolean
  waiting?: boolean
}

/** Host: set room flags (lock / waiting room). */
export function setRoomFlags(req: RoomFlagsRequest): Promise<void> {
  return postJson<{ ok: boolean }>('/api/roomflags', req).then(() => undefined)
}

/**
 * Send a real email invite (Resend). Resolves true if sent; false on ANY
 * failure — not configured (501) OR the provider rejected it (502, e.g. an
 * unverified sandbox recipient). Either way the caller falls back to mailto, so
 * an invite never silently drops. Only a network error rejects the promise.
 */
export async function sendEmailInvite(to: string, room: string, link: string, fromName: string): Promise<boolean> {
  const res = await fetch('/api/email-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
}

/** Probe server-side capabilities for the setup-status surface. Never throws. */
export async function getHealth(): Promise<ServerHealth> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { ok: false, hasKeys: false, email: false }
    return (await res.json()) as ServerHealth
  } catch {
    return { ok: false, hasKeys: false, email: false }
  }
}
