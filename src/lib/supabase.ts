import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Sanitize: pasting build vars into a dashboard often injects whitespace —
// including a newline in the MIDDLE of a long key when the field wraps. That
// char reaches the request headers and fetch throws "Invalid value", breaking
// sign-in. The URL and the JWT key contain no whitespace, so it's safe to strip
// all of it (plus stray surrounding quotes / trailing slash on the URL).
const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\s+/g, '')
  .replace(/^["']|["']$/g, '')
  .replace(/\/+$/, '')
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.replace(/\s+/g, '').replace(/^["']|["']$/g, '')

/** Null when Supabase isn't configured — the app runs guest-only in that case. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const authEnabled = Boolean(supabase)
