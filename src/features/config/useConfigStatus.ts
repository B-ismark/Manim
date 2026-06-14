import { useEffect, useState } from 'react'
import { getHealth, LIVEKIT_URL } from '@/lib/orchestrator'
import { authEnabled } from '@/lib/supabase'
import { gifEnabled } from '@/islands/GifPicker'

export interface ConfigItem {
  key: string
  label: string
  ok: boolean
  /** Required = the app's core (calls) won't work without it. */
  required: boolean
  /** What to set to enable it. */
  hint: string
}

export interface ConfigStatus {
  items: ConfigItem[]
  /** True once the server health probe has resolved. */
  ready: boolean
  /** A required capability is missing — calls won't work. */
  blocked: boolean
}

/**
 * Single source of truth for "what's configured". Combines client-side env
 * (VITE_* baked into the bundle) with a server health probe (keys/email the
 * browser must never see). Drives the SetupStatus surface; every feature also
 * degrades gracefully on its own (GIF button hidden, email → mailto, etc.).
 */
export function useConfigStatus(): ConfigStatus {
  const [health, setHealth] = useState<{ hasKeys: boolean; email: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    getHealth().then((h) => {
      if (alive) setHealth({ hasKeys: h.hasKeys, email: h.email })
    })
    return () => {
      alive = false
    }
  }, [])

  const items: ConfigItem[] = [
    {
      key: 'livekit',
      label: 'Video calls',
      // Needs the public URL (build) AND the server keys (runtime secrets).
      ok: Boolean(LIVEKIT_URL) && Boolean(health?.hasKeys),
      required: true,
      hint: 'Set VITE_LIVEKIT_URL (build var) plus LIVEKIT_API_KEY and LIVEKIT_API_SECRET as runtime Secrets on the Worker.',
    },
    {
      key: 'accounts',
      label: 'Accounts & call-by-email',
      ok: authEnabled,
      required: false,
      hint: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (build vars). Guests work without it.',
    },
    {
      key: 'email',
      label: 'Email invites',
      ok: Boolean(health?.email),
      required: false,
      hint: 'Set RESEND_API_KEY (runtime Secret) + a verified RESEND_FROM domain. Falls back to your mail app otherwise.',
    },
    {
      key: 'gifs',
      label: 'GIF picker',
      ok: gifEnabled,
      required: false,
      hint: 'Set VITE_GIPHY_KEY (build var). The GIF button is hidden without it.',
    },
  ]

  return {
    items,
    ready: health !== null,
    blocked: items.some((i) => i.required && !i.ok),
  }
}
