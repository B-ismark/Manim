import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

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
  signOut: async () => {
    if (supabase) await supabase.auth.signOut()
    set({ userId: guestId(), email: null, signedIn: false })
  },
}))

function applySession(session: Session | null) {
  if (session?.user) {
    useAuthStore.setState({
      userId: session.user.id,
      email: session.user.email ?? null,
      signedIn: true,
    })
    // Make this user reachable by email for calls (best-effort; needs a
    // `profiles` table — see deploy docs). Degrades silently if absent.
    if (supabase && session.user.email) {
      void supabase
        .from('profiles')
        .upsert({ id: session.user.id, email: session.user.email })
        .then(() => {})
    }
  } else {
    useAuthStore.setState({ userId: guestId(), email: null, signedIn: false })
  }
}

/** Call once at startup: hydrate session + subscribe to auth changes. */
export function initAuth(): void {
  if (!supabase) return
  void supabase.auth.getSession().then(({ data }) => applySession(data.session))
  supabase.auth.onAuthStateChange((_event, session) => applySession(session))
}
