import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Trim: a stray newline/space (easy to introduce when pasting build vars) makes
// it into the request headers and fetch rejects it with "Invalid value".
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** Null when Supabase isn't configured — the app runs guest-only in that case. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const authEnabled = Boolean(supabase)
