/**
 * Get the media server's DNS and TLS out of the way while the person is still on
 * the join screen.
 *
 * The first thing Join does after the knock is open a WebSocket to the media
 * server — and on a cold page that socket pays a DNS lookup and a full TLS
 * handshake before a single signalling byte moves: two to four round trips, which
 * on a phone network is most of a second of "Joining…". The prejoin screen sits
 * there for seconds anyway (name, camera check), so that cost can be paid then.
 *
 * Browsers keep preconnected sockets in the HTTP pool, which a WebSocket may not
 * draw from, so a `<link rel="preconnect">` alone is a hint at best. A real request
 * is what livekit-client's own `prepareConnection` makes (`HEAD` to the server's
 * root, which answers 200): it resolves the host — the part that surely carries
 * over — and leaves a TLS session the WebSocket handshake can resume. This is that
 * request, without importing livekit-client on the join screen. `no-cors`, because
 * the answer is never read. Credentialed, like the WebSocket itself: Chromium keeps
 * credentialed and anonymous connections (and their TLS sessions) apart, so an
 * anonymous warm-up would warm a pool the real connection never uses.
 *
 * Once per page and per server; failures are silent (the join just pays the cost
 * as before).
 */
const warmed = new Set<string>()

/** The HTTP(S) origin a ws(s) media-server URL connects to, or null if it isn't one. */
export function warmOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol === 'wss:') u.protocol = 'https:'
    else if (u.protocol === 'ws:') u.protocol = 'http:'
    else if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}

export function warmConnection(url: string): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  const origin = warmOrigin(url)
  if (!origin || warmed.has(origin)) return
  warmed.add(origin)
  try {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = origin
    document.head.appendChild(link)
  } catch {
    /* no DOM to hint through — the request below still warms */
  }
  fetch(origin, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'include' }).catch(() => {})
}
