import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Null when Supabase isn't configured — the app runs guest-only in that case. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const authEnabled = Boolean(supabase)
