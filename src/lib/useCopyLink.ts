import { useCallback, useState } from 'react'

/** Copy the current room URL to the clipboard with transient confirmation. */
export function useCopyLink() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [])
  return { copied, copy }
}
