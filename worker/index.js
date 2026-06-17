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
    // Static assets (SPA fallback handled by [assets] not_found_handling). We
    // re-emit them cross-origin isolated so SharedArrayBuffer is available — the
    // @livekit/krisp-noise-filter (the strong AI noise suppression) needs it;
    // without isolation it silently falls back to the weak browser filter.
    // `credentialless` is the least-breaking isolation mode: cross-origin no-cors
    // subresources (Giphy GIF previews, MediaPipe CDN wasm for blur) still load.
    const res = await env.ASSETS.fetch(request)
    const headers = new Headers(res.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
    // Defense-in-depth. The app has no known injection sink (chat renders React
    // nodes, not HTML; remote images are click-to-load), so CSP is a safety net.
    // connect/img/style are kept permissive enough not to break LiveKit (wss),
    // Supabase (https+wss), Giphy, or Tailwind's injected styles; the strict bits
    // (frame-ancestors, object-src, base-uri) block clickjacking + base-tag/object
    // injection. script-src allows the MediaPipe CDN + wasm (blur) only.
    // NOTE: verify against the DEPLOYED artifact — tune if a console CSP violation
    // appears (this worker path doesn't run under the local vite dev server).
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
        "worker-src 'self' blob:",
        "connect-src 'self' https: wss:",
      ].join('; '),
    )
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  },
}
