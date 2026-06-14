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

/** A bare URL that points at an image / GIF (so chat can render it inline). */
export function looksLikeImageUrl(text: string): boolean {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/.test(t) || /\s/.test(t)) return false
  return IMAGE_URL.test(t) || /(\.|\/\/)(tenor|giphy)\.com|media\.tenor/i.test(t)
}
