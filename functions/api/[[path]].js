/*
  Cloudflare Pages Function — production backend. Wraps the shared orchestration
  core (server/core.mjs), the same logic the local Express dev server uses.
  Served same-origin under /api/*, so no CORS needed.

  Requires the Pages project to have the `nodejs_compat` flag (see wrangler.toml)
  and these env vars: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, VITE_LIVEKIT_URL,
  and optionally RESEND_API_KEY / RESEND_FROM.
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
} from '../../server/core.mjs'

const json = (r) =>
  new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  })

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\//, '')
  const method = request.method
  const query = Object.fromEntries(url.searchParams)
  const bodyOf = () => request.json().catch(() => ({}))

  try {
    if (path === 'health') return json(handleHealth(env))
    if (path === 'knock' && method === 'POST') return json(await handleKnock(env, await bodyOf()))
    if (path === 'knock-status') return json(await handleKnockStatus(env, query))
    if (path === 'pending') return json(await handlePending(env, query))
    if (path === 'admit' && method === 'POST') return json(await handleAdmit(env, await bodyOf()))
    if (path === 'moderate' && method === 'POST') return json(await handleModerate(env, await bodyOf()))
    if (path === 'roomflags' && method === 'POST') return json(await handleRoomflags(env, await bodyOf()))
    if (path === 'email-invite' && method === 'POST')
      return json(await handleEmailInvite(env, await bodyOf()))
    return new Response('Not found', { status: 404 })
  } catch {
    return json({ status: 500, body: { error: 'server error' } })
  }
}
