/**
 * An invite link's #fragment carries `k=<join secret>&e=<E2EE key>` (lib/roomLink).
 * Emailing the link handed the E2EE key to our mail provider and to every mail
 * server and inbox scanner on the way, while the privacy page promised the key
 * never reaches a server. The emailed link now keeps the join secret (so it still
 * opens the room) and drops the key; the email says so and tells the guest to get
 * the full link from whoever invited them.
 */
export function withoutE2eeKey(link) {
  const url = new URL(link)
  const params = new URLSearchParams(url.hash.replace(/^#/, ''))
  const hadKey = params.has('e')
  params.delete('e')
  const rest = params.toString()
  url.hash = rest ? `#${rest}` : ''
  return { url, hadKey }
}
