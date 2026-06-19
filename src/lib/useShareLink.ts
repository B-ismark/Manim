import { useCallback, useState } from 'react'

/**
 * Share the current room URL. The URL already carries the invite secret + E2EE key
 * in its #fragment (see lib/roomLink), so `window.location.href` IS the full
 * shareable link on any room surface — no reconstruction needed.
 *
 * Prefers the native share sheet (`navigator.share`) where available — mostly
 * mobile, where it opens WhatsApp / Messages / etc. — and falls back to copying to
 * the clipboard with a transient "copied" confirmation everywhere else. Dismissing
 * the share sheet is a no-op, not an error.
 */
export function useShareLink() {
  const [copied, setCopied] = useState(false)

  const share = useCallback(async (data?: { title?: string; text?: string }) => {
    const url = window.location.href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ ...data, url })
        return
      } catch (e) {
        // User cancelled the sheet — leave it; don't fall through to a silent copy.
        if (e instanceof DOMException && e.name === 'AbortError') return
        // Any other failure (sheet unavailable, blocked) → fall back to copy below.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [])

  return { copied, share }
}
