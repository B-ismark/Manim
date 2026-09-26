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
} from '../server/core.mjs'
import { rewriteHead, roomFromPath } from '../server/preview.mjs'
import { count } from '../server/usage.mjs'
import { CSP } from '../server/headers.mjs'

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
    if (path === 'me' && method === 'POST') return json(await handleMe(env, await bodyOf()))
    if (path === 'knock' && method === 'POST') {
      // Per-IP rate limit on the (intentionally unauthenticated) join endpoint.
      // knock is how anyone enters a room, so it can't require a token — which is
      // exactly what makes room enumeration cheap. Throttling per IP blunts a
      // brute-force scan of the room-code space. Degrades gracefully when the
      // binding is absent (local dev), so it only bites in production.
      const limiter = env.KNOCK_RATELIMIT
      if (limiter && typeof limiter.limit === 'function') {
        const ip = request.headers.get('cf-connecting-ip') || 'anon'
        const { success } = await limiter.limit({ key: `knock:${ip}` })
        if (!success) {
          return json({ status: 429, body: { error: 'Too many attempts — wait a moment and try again.' } })
        }
      }
      const r = await handleKnock(env, await bodyOf())
      // Why people don't get in (anonymous; usage.mjs keeps only listed codes).
      if (r.body?.code) count(env, 'knock_rejected', r.body.code)
      return json(r)
    }
    if (path === 'knock-status') {
      const r = await handleKnockStatus(env, query)
      // A guest stops polling on the first settled answer, so each is counted once.
      if (r.status === 200 && r.body?.status === 'denied') count(env, 'knock_rejected', 'host_denied')
      if (r.status === 200 && r.body?.status === 'expired') count(env, 'knock_rejected', 'timed_out')
      return json(r)
    }
    if (path === 'count' && method === 'POST') {
      // Anonymous usage counts (server/usage.mjs, docs/analytics-proposal.md). The
      // body is an event name and at most two values from a fixed list — nothing
      // else is read, and the IP is used only for this rate limit, never stored.
      const limiter = env.COUNT_RATELIMIT
      if (limiter && typeof limiter.limit === 'function') {
        const ip = request.headers.get('cf-connecting-ip') || 'anon'
        const { success } = await limiter.limit({ key: `count:${ip}` })
        if (!success) return new Response(null, { status: 204 })
      }
      const b = await bodyOf()
      count(env, String(b.e || ''), String(b.a || ''), String(b.b || ''))
      return new Response(null, { status: 204 })
    }
    if (path === 'pending') return json(await handlePending(env, query, bearer(request)))
    if (path === 'admit' && method === 'POST') return json(await handleAdmit(env, await bodyOf(), bearer(request)))
    if (path === 'end' && method === 'POST') return json(await handleEndRoom(env, await bodyOf(), bearer(request)))
    if (path === 'elect-host' && method === 'POST') return json(await handleElectHost(env, await bodyOf(), bearer(request)))
    if (path === 'handoff' && method === 'POST') return json(await handleHandoff(env, await bodyOf(), bearer(request)))
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
      // The app's own origin, from the URL this request actually hit — never a
      // client header — so an invite can only ever link back here.
      return json(await handleEmailInvite(env, await bodyOf(), bearer(request), url.origin))
    }
    if (path === 'push' && method === 'POST') {
      // Per-IP rate limit: each call wakes a contact's phone, so an unthrottled
      // endpoint could buzz someone's devices on a loop. A real ring is one call.
      const limiter = env.PUSH_RATELIMIT
      if (limiter && typeof limiter.limit === 'function') {
        const ip = request.headers.get('cf-connecting-ip') || 'anon'
        const { success } = await limiter.limit({ key: `push:${ip}` })
        if (!success) return json({ status: 429, body: { error: 'Too many calls — wait a moment and try again.' } })
      }
      return json(await handlePushRing(env, await bodyOf()))
    }
    return new Response('Not found', { status: 404 })
  } catch {
    return json({ status: 500, body: { error: 'Something went wrong on our side. Try again in a moment.' } })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url)
    // Only the pages in run_worker_first reach here (wrangler.toml); every other
    // file gets the same headers from public/_headers. We serve them
    // cross-origin isolated so SharedArrayBuffer is available — the
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
    // injection. script-src allows the MediaPipe CDN + wasm (blur), and Sentry's
    // loader (js.sentry-cdn.com) plus the SDK bundle it pulls in
    // (browser.sentry-cdn.com) for crash reports when VITE_SENTRY_DSN is set; the
    // reports themselves go to *.ingest.sentry.io, already inside connect-src.
    // NOTE: verify against the DEPLOYED artifact — tune if a console CSP violation
    // appears (this worker path doesn't run under the local vite dev server).
    headers.set('Content-Security-Policy', CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (roomFromPath(url.pathname)) headers.set('X-Robots-Tag', 'noindex, nofollow')
    // Link previews: the one HTML document gets a head written for the URL it's
    // served at (per-room title, absolute image) — see server/preview.mjs. Only a
    // 200 has a body to rewrite: a revalidation 304 must pass through untouched
    // (a Response with a body and a null-body status throws, which would fail
    // every returning visitor's page load).
    if (
      request.method === 'GET' &&
      res.status === 200 &&
      (res.headers.get('content-type') || '').includes('text/html')
    ) {
      headers.delete('content-length')
      const html = rewriteHead(await res.text(), { origin: url.origin, pathname: url.pathname })
      return new Response(html, { status: res.status, statusText: res.statusText, headers })
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  },

  // Keep the free Supabase project awake. Free projects pause after a week with no
  // activity, and with BETA_GATE on a paused project fails every host's sign-in
  // check, so no one can start a call until someone restores it by hand. Twice a
  // week (wrangler.toml [triggers]) is well inside that window. One cheap read:
  // RLS returns nothing to the anon key, but it's a real database request.
  async scheduled(_event, env, ctx) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return
    ctx.waitUntil(
      fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
      }).catch(() => {}),
    )
  },
}
