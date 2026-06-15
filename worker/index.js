/*
  Cloudflare Worker entry (Workers + Static Assets model). Serves the built SPA
  (via the ASSETS binding) and routes /api/* to the shared orchestration core
  (server/core.mjs) — the same logic the local Express dev server uses.

  Deployed with `wrangler deploy` per wrangler.toml. Requires the `nodejs_compat`
  flag and env vars: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, VITE_LIVEKIT_URL, and
  optionally RESEND_API_KEY / RESEND_FROM.
*/
import {
  handleHealth,
  handleKnock,
  handleKnockStatus,
  handlePending,
  handleAdmit,
  handleModerate,
  handleRoomflags,
  handleEmailInvite,
} from '../server/core.mjs'

const json = (r) =>
  new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  })

// Bearer token = the caller's signed LiveKit join token. Host endpoints verify it
// server-side (see ensureHost in core.mjs) instead of trusting a plaintext identity.
const bearer = (request) => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api\//, '')
  const method = request.method
  const query = Object.fromEntries(url.searchParams)
  const bodyOf = () => request.json().catch(() => ({}))

  try {
    if (path === 'health') return json(handleHealth(env))
    if (path === 'knock' && method === 'POST') return json(await handleKnock(env, await bodyOf()))
    if (path === 'knock-status') return json(await handleKnockStatus(env, query))
    if (path === 'pending') return json(await handlePending(env, query, bearer(request)))
    if (path === 'admit' && method === 'POST') return json(await handleAdmit(env, await bodyOf(), bearer(request)))
    if (path === 'moderate' && method === 'POST') return json(await handleModerate(env, await bodyOf(), bearer(request)))
    if (path === 'roomflags' && method === 'POST') return json(await handleRoomflags(env, await bodyOf(), bearer(request)))
    if (path === 'email-invite' && method === 'POST') {
      // Per-IP rate limit (native Workers binding) to keep the unauthenticated
      // invite endpoint from being used as a spam relay. Degrades gracefully if
      // the binding isn't present.
      const limiter = env.EMAIL_RATELIMIT
      if (limiter && typeof limiter.limit === 'function') {
        const ip = request.headers.get('cf-connecting-ip') || 'anon'
        const { success } = await limiter.limit({ key: `email:${ip}` })
        if (!success) {
          return json({ status: 429, body: { error: 'Too many invites — try again in a minute.' } })
        }
      }
      return json(await handleEmailInvite(env, await bodyOf()))
    }
    return new Response('Not found', { status: 404 })
  } catch {
    return json({ status: 500, body: { error: 'server error' } })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url)
    // Static assets (SPA fallback handled by [assets] not_found_handling).
    return env.ASSETS.fetch(request)
  },
}
