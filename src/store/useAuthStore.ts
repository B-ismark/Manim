import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'

/** Stable guest id (device-bound) used when not signed in. */
function guestId(): string {
  const KEY = 'manim-guest-id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `guest-${crypto.randomUUID().slice(0, 8)}`
    localStorage.setItem(KEY, id)
  }
  return id
}

interface AuthState {
  /** Supabase user id when signed in, else a stable guest id. Drives presence + handoff. */
  userId: string
  email: string | null
  signedIn: boolean
  /** Sends a magic link. Resolves once the email is dispatched. */
  signInWithEmail: (email: string) => Promise<void>
  /** Google OAuth — one tap, carries the existing Google session across devices. */
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: guestId(),
  email: null,
  signedIn: false,
  signInWithEmail: async (email) => {
    if (!supabase) throw new Error('Sign-in is not configured.')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
  },
  signInWithGoogle: async () => {
    if (!supabase) throw new Error('Sign-in is not configured.')
    // Redirects to Google, then back to the app origin where onAuthStateChange
    // (initAuth) picks up the session. Requires the Google provider to be enabled
    // in the Supabase dashboard (OAuth client id/secret) — see DEPLOY.md.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) throw error
  },
  signOut: async () => {
    if (supabase) await supabase.auth.signOut()
    set({ userId: guestId(), email: null, signedIn: false })
  },
}))

/** Best display name from an OAuth/magic-link session: provider full name first,
 *  then the email local-part, so a signed-in user never has to type their name. */
function nameFromSession(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined
  return (
    meta?.full_name?.trim() ||
    meta?.name?.trim() ||
    session.user.email?.split('@')[0] ||
    ''
  )
}

/**
 * Sync the display name with the signed-in account: the account row is the source
 * of truth (so the name follows the user across devices). If the account has no
 * name yet, adopt what they typed on this device (or the provider/email name) and
 * write it back. Also keeps the email on the row for call-by-email lookup. All
 * best-effort — degrades silently without the `profiles` table / `display_name`
 * column (see DEPLOY.md).
 */
async function syncProfile(session: Session) {
  if (!supabase) return
  const local = useAppStore.getState().displayName.trim()

  let accountName = ''
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .maybeSingle()
    accountName = (data?.display_name ?? '').trim()
  } catch {
    /* no profiles table / display_name column — fall back to device + provider */
  }

  // Account wins for a signed-in user; otherwise keep their device name, then the
  // provider/email name as a last resort.
  const resolved = accountName || local || nameFromSession(session)
  if (resolved && resolved !== local) useAppStore.getState().setDisplayName(resolved)

  try {
    await supabase.from('profiles').upsert({
      id: session.user.id,
      ...(session.user.email ? { email: session.user.email } : {}),
      ...(resolved ? { display_name: resolved } : {}),
    })
  } catch {
    /* table/column absent — guest-grade experience, no account sync */
  }
}

function applySession(session: Session | null) {
  if (session?.user) {
    useAuthStore.setState({
      userId: session.user.id,
      email: session.user.email ?? null,
      signedIn: true,
    })
    void syncProfile(session)
  } else {
    useAuthStore.setState({ userId: guestId(), email: null, signedIn: false })
  }
}

let nameWriteTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Persist the display name onto the signed-in user's account row so it follows
 * them to other devices. Debounced (coalesces per-keystroke edits) and best-effort
 * — a no-op for guests or when Supabase / the column isn't configured. Called by
 * useAppStore.setDisplayName so every edit path stays in sync.
 */
export function persistNameToAccount(name: string): void {
  const sb = supabase
  const { signedIn, userId } = useAuthStore.getState()
  if (!sb || !signedIn) return
  const id = userId
  const display_name = name.trim()
  clearTimeout(nameWriteTimer)
  nameWriteTimer = setTimeout(() => {
    void sb.from('profiles').upsert({ id, display_name }).then(() => {})
  }, 600)
}

/** Call once at startup: hydrate session + subscribe to auth changes. */
export function initAuth(): void {
  if (!supabase) return
  void supabase.auth.getSession().then(({ data }) => applySession(data.session))
  supabase.auth.onAuthStateChange((_event, session) => applySession(session))
}
