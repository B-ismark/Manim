import type { SupabaseClient } from '@supabase/supabase-js'

// Sanitize: pasting build vars into a dashboard often injects whitespace —
// including a newline in the MIDDLE of a long key when the field wraps. That
// char reaches the request headers and fetch throws "Invalid value", breaking
// sign-in. The URL and the JWT key contain no whitespace, so it's safe to strip
// all of it (plus stray surrounding quotes / trailing slash on the URL).
const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\s+/g, '')
  .replace(/^["']|["']$/g, '')
  .replace(/\/+$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.replace(/\s+/g, '').replace(/^["']|["']$/g, '')

/** False when Supabase isn't configured — the app runs guest-only in that case. */
export const authEnabled = Boolean(url && key)

/**
 * The client, once loaded; null before that (and always, when not configured).
 *
 * supabase-js is ~45 KB gzipped and used to sit in the entry bundle, so every
 * visitor, most of them guests opening an invite, downloaded and parsed it before
 * the first paint. It now loads as its own chunk right after startup
 * (`getSupabase`, kicked off by initAuth). This is a live binding: code that only
 * runs for a signed-in user can read it directly, because being signed in means
 * the client has loaded. Anything that may run earlier awaits `getSupabase()`.
 */
export let supabase: SupabaseClient | null = null
let loading: Promise<SupabaseClient | null> | null = null
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!authEnabled) return Promise.resolve(null)
  loading ??= import('@supabase/supabase-js')
    .then(({ createClient }) => (supabase = createClient(url!, key!)))
    .catch(() => {
      // A failed chunk load (offline, a deploy swapped the files) must not stick:
      // the next caller tries again.
      loading = null
      return null
    })
  return loading
}
