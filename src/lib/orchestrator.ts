/*
  Client side of the session orchestrator. Today it only fetches a join token
  from the dev token server. Merge / handoff / waiting-room admit calls will be
  added here (same module) in later milestones — the UI imports from one place.
*/

export interface TokenRequest {
  room: string
  name: string
  deviceId: string
  host?: boolean
}

export interface TokenResponse {
  token: string
  identity: string
}

export async function fetchToken(req: TokenRequest): Promise<TokenResponse> {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `token request failed (${res.status})`)
  }
  return (await res.json()) as TokenResponse
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

export async function moderate(req: ModerateRequest): Promise<void> {
  const res = await fetch('/api/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `moderation failed (${res.status})`)
  }
}

export interface LockRequest {
  room: string
  /** Host identity (verified server-side). */
  caller: string
  locked: boolean
}

export async function setLock(req: LockRequest): Promise<void> {
  const res = await fetch('/api/lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `lock failed (${res.status})`)
  }
}

export const LIVEKIT_URL: string = import.meta.env.VITE_LIVEKIT_URL ?? ''
