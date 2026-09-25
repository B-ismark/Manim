/* Upload + media thresholds for chat (shared by composer guard and renderer). */

/** Hard cap per file — larger uploads are rejected (data channel is P2P, keep it sane). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB
/** Images at or below this size preview inline; larger images show as a download card. */
export const IMAGE_INLINE_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
/** Reject empty files. */
export const MIN_UPLOAD_BYTES = 1

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

/** Returns a human error if the file violates the thresholds, else null. */
export function uploadError(file: File): string | null {
  if (file.size < MIN_UPLOAD_BYTES) return `${file.name} is empty.`
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is too large (max ${mb(MAX_UPLOAD_BYTES)} MB).`
  return null
}

const IMAGE_URL = /\.(gif|png|jpe?g|webp|avif)(\?.*)?$/i
/** The GIF picker's own CDNs — the only hosts an image may auto-load from. */
const TRUSTED_IMAGE_HOSTS = ['giphy.com', 'tenor.com', 'tenor.co']

/**
 * Host check on the PARSED hostname. The old test was a regex over the whole URL,
 * so `https://evil.example/?x=.giphy.com` and `https://giphy.com.evil.example/`
 * both passed — and auto-loading is exactly what makes a URL a tracking pixel.
 */
function isTrustedImageHost(text: string): boolean {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return TRUSTED_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** A bare URL that points at an image / GIF (so chat can render it inline). */
export function looksLikeImageUrl(text: string): boolean {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/.test(t) || /\s/.test(t)) return false
  return IMAGE_URL.test(t) || isTrustedImageHost(t)
}

/**
 * Whether an image URL may be auto-fetched (rendered as <img> on receive). Only
 * the GIF picker's own hosts (giphy/tenor) qualify; any OTHER remote URL is
 * click-to-load, so a sender can't use an arbitrary endpoint as a tracking pixel
 * to harvest every recipient's IP/UA/online-timing on message receipt.
 */
export function isAutoLoadImageUrl(text: string): boolean {
  return isTrustedImageHost(text)
}
