/**
 * Link previews: what WhatsApp, Slack, iMessage, X and LinkedIn show when an
 * invite is pasted.
 *
 * Unfurlers fetch the URL from their own servers and read the static <head>; none
 * of them run the app. So every invite used to unfurl as the same generic "Manim —
 * Video Calls" with no image — and on X and LinkedIn as nothing at all, because
 * their bots honour robots.txt and it disallowed /r/. The Worker now rewrites the
 * head of the one HTML document it serves: a per-room title, an absolute image URL
 * (Facebook/WhatsApp ignore relative ones), and og:url.
 *
 * Privacy stays where it was, arguably better:
 *  - Unfurlers never receive the #fragment, which is where the join secret and the
 *    E2EE key live (a fragment is never sent in an HTTP request). Nothing here
 *    could leak them even if it tried.
 *  - The random code in a generated slug (`swift-falcon-kq7mz3xhp2rtd`) is dropped
 *    from the title. It's in the URL anyway, but a card is what ends up in
 *    screenshots of a chat, and "Swift Falcon" reads better.
 *  - Room pages carry `noindex` (meta + X-Robots-Tag) instead of a robots.txt
 *    block. A disallowed URL can still be indexed from links alone — Google just
 *    can't read the page to learn it shouldn't be — so noindex is the stronger
 *    "keep rooms out of search", and it lets preview bots in.
 *
 * Pure string work on purpose: it runs in the Worker and in Node's unit tests, and
 * index.html is small and ours, so a parser would buy nothing.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c])

/** The CSPRNG suffix Landing's randomRoom() appends: 13 chars, no 0/o/1/l/i. */
const GENERATED_CODE = /^[a-hjkmnp-z2-9]{13}$/

/** "swift-falcon-kq7mz3xhp2rtd" → "Swift Falcon"; "team-standup" → "Team Standup". */
export function roomTitle(slug) {
  let s
  try {
    s = decodeURIComponent(String(slug || ''))
  } catch {
    s = String(slug || '')
  }
  const words = s.split(/[-_]+/).filter(Boolean)
  if (words.length > 1 && GENERATED_CODE.test(words[words.length - 1])) words.pop()
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  // Chat apps clip long titles anyway; a bounded one keeps the card tidy.
  return Array.from(title).length > 60 ? Array.from(title).slice(0, 59).join('') + '…' : title
}

/** The room slug for a /r/<slug> path, else null. */
export function roomFromPath(pathname) {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}

const INVITE_DESCRIPTION = 'You’re invited to a video call. It opens in your browser, with nothing to install.'

function setMeta(html, attr, key, content) {
  const tag = `<meta ${attr}="${key}" content="${esc(content)}" />`
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`, 'i')
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

/**
 * Rewrite index.html's head for the URL it's being served at.
 * `origin` is the origin the request hit; `pathname` its path.
 */
export function rewriteHead(html, { origin, pathname }) {
  let out = html
  // Absolute image URLs everywhere: several unfurlers drop a relative og:image.
  out = out.replace(/(<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content=")\/(?!\/)/gi, `$1${origin}/`)
  out = setMeta(out, 'property', 'og:url', origin + pathname)

  const slug = roomFromPath(pathname)
  if (!slug) return out
  const name = roomTitle(slug)
  const title = name ? `${name} · Manim` : 'Join a call · Manim'
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`)
  out = setMeta(out, 'property', 'og:title', title)
  out = setMeta(out, 'name', 'twitter:title', title)
  out = setMeta(out, 'property', 'og:description', INVITE_DESCRIPTION)
  out = setMeta(out, 'name', 'twitter:description', INVITE_DESCRIPTION)
  out = setMeta(out, 'name', 'description', INVITE_DESCRIPTION)
  out = setMeta(out, 'name', 'robots', 'noindex, nofollow')
  return out
}
