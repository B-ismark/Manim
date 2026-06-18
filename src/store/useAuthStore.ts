import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToastStore'
import { squareDownscale } from '@/lib/image'

/** Public Storage bucket holding user avatars (see DEPLOY.md §4a). */
const AVATAR_BUCKET = 'avatars'

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
  /** Profile photo URL (Storage public URL or the provider's OAuth photo). Null = initials. */
  avatarUrl: string | null
  /** Sends a magic link. Resolves once the email is dispatched. */
  signInWithEmail: (email: string) => Promise<void>
  /** Verify the 6-digit code from the sign-in email. The mobile-safe alternative to
   *  the link: a copy/pasted code survives switching to the mail app and back, where
   *  the link's single-browser PKCE flow breaks if it opens in a different browser. */
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  /** Google OAuth — one tap, carries the existing Google session across devices. */
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /** Upload a new profile photo (downscaled client-side) to Storage + the account row. */
  uploadAvatar: (file: File) => Promise<void>
  /** Clear the profile photo (Storage object + account row). */
  removeAvatar: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  userId: guestId(),
  email: null,
  signedIn: false,
  avatarUrl: null,
  signInWithEmail: async (email) => {
    if (!supabase) throw new Error('Sign-in is not configured.')
    const { error } = await supabase.auth.signInWithOtp({
      // Return to the EXACT page sign-in started from (e.g. /r/standup), not the
      // bare origin — otherwise a user who signs in mid-join lands on / and has to
      // re-navigate. href carries the path + any query.
      email,
      options: { emailRedirectTo: window.location.href },
    })
    if (error) throw error
  },
  verifyEmailOtp: async (email, token) => {
    if (!supabase) throw new Error('Sign-in is not configured.')
    // type 'email' covers the OTP token from a signInWithOtp email. On success the
    // onAuthStateChange listener (initAuth) applies the session — no extra wiring.
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' })
    if (error) throw error
  },
  signInWithGoogle: async () => {
    if (!supabase) throw new Error('Sign-in is not configured.')
    // Redirects to Google, then back to the page sign-in started from, where
    // onAuthStateChange (initAuth) picks up the session. Requires the Google
    // provider enabled in the Supabase dashboard (OAuth client id/secret) — see
    // DEPLOY.md. (The exact return URL must be in Supabase's allow-list.)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (error) throw error
  },
  signOut: async () => {
    if (supabase) await supabase.auth.signOut()
    set({ userId: guestId(), email: null, signedIn: false, avatarUrl: null })
  },

  uploadAvatar: async (file) => {
    const sb = supabase
    const { signedIn, userId } = get()
    if (!sb || !signedIn) throw new Error('Sign in to add a photo.')

    // Shrink + square-crop in the browser so we store a few-KB webp, not the
    // original multi-MB photo. Fixed filename → one object per user (upsert).
    const blob = await squareDownscale(file)
    const path = `${userId}/avatar.webp`
    const { error: upErr } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(path, blob, { upsert: true, contentType: 'image/webp' })
    if (upErr) throw new Error('Upload failed. Check the avatars bucket exists (see DEPLOY.md).')

    // Cache-bust so the new image shows immediately (same path, public CDN URL).
    const base = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
    const url = `${base}?v=${Date.now()}`

    await sb.from('profiles').upsert({ id: userId, avatar_url: url })
    set({ avatarUrl: url })
  },

  removeAvatar: async () => {
    const sb = supabase
    const { signedIn, userId } = get()
    if (!sb || !signedIn) return
    // Best-effort delete of the Storage object (a provider-seeded OAuth URL has
    // none — ignore). Then null the account row so it doesn't re-seed.
    await sb.storage.from(AVATAR_BUCKET).remove([`${userId}/avatar.webp`])
    await sb.from('profiles').upsert({ id: userId, avatar_url: null })
    set({ avatarUrl: null })
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

/** Provider profile photo (Google sets `avatar_url`/`picture`), so signed-in users
 *  start with a real photo without uploading one. */
function avatarFromSession(session: Session): string {
  const meta = session.user.user_metadata as { avatar_url?: string; picture?: string } | undefined
  return meta?.avatar_url?.trim() || meta?.picture?.trim() || ''
}

/**
 * Sync the display name + avatar with the signed-in account: the account row is
 * the source of truth (so they follow the user across devices). If the account
 * has no name/photo yet, adopt what's on this device / the provider and write it
 * back. Also keeps the email on the row for call-by-email lookup. All best-effort
 * — degrades silently without the `profiles` table / columns (see DEPLOY.md).
 */
async function syncProfile(session: Session) {
  if (!supabase) return
  const local = useAppStore.getState().displayName.trim()

  // Distinguish "no profile row yet" (first sign-in → seed) from "row exists but
  // has no name" (don't let a stale device name clobber a deliberately-cleared
  // account name on another device).
  let hasRow = false
  let accountName = ''
  let accountAvatar = ''
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', session.user.id)
      .maybeSingle()
    hasRow = data !== null
    accountName = (data?.display_name ?? '').trim()
    accountAvatar = (data?.avatar_url ?? '').trim()
  } catch {
    /* no profiles table / columns — fall back to provider/device */
  }

  // The account is authoritative when it has a name. Otherwise seed from the
  // provider name (stable across devices) before the device-local name, so a
  // stale localStorage value on one device can't overwrite the account.
  const resolved = accountName || nameFromSession(session) || local
  // Account photo wins; otherwise seed from the provider's OAuth photo.
  const resolvedAvatar = accountAvatar || avatarFromSession(session)

  // Apply locally WITHOUT re-persisting (persist=false) — this value came from /
  // is being written to the account here, so the debounced push would be a
  // redundant double-write that races this upsert.
  if (resolved && resolved !== local) useAppStore.getState().setDisplayName(resolved, false)
  useAuthStore.setState({ avatarUrl: resolvedAvatar || null })

  try {
    const patch: Record<string, string> = {}
    if (resolved && resolved !== accountName) patch.display_name = resolved
    if (resolvedAvatar && resolvedAvatar !== accountAvatar) patch.avatar_url = resolvedAvatar
    if (Object.keys(patch).length > 0) {
      // Seeding or correcting the account (also carries the email).
      await supabase.from('profiles').upsert({
        id: session.user.id,
        ...(session.user.email ? { email: session.user.email } : {}),
        ...patch,
      })
    } else if (session.user.email && !hasRow) {
      // Nothing to set but no row yet — ensure the email exists for call-by-email.
      await supabase.from('profiles').upsert({ id: session.user.id, email: session.user.email })
    }
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
    useAuthStore.setState({ userId: guestId(), email: null, signedIn: false, avatarUrl: null })
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

/**
 * Surface an auth failure that came back on the redirect URL. OAuth bounce-backs
 * (user cancelled, redirect URL not allow-listed) and dead magic links (expired,
 * or opened in a different browser than they were started in — the PKCE verifier
 * is local) return `error`/`error_description` in the query OR the hash. Without
 * this the user just lands logged-out with no reason. Toast it, then strip the
 * error keys so a reload doesn't re-announce (other params, incl. tokens Supabase
 * consumes, are preserved).
 */
function reportAuthErrorFromUrl(): void {
  if (typeof window === 'undefined') return
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const raw = query.get('error_description') || query.get('error') || hash.get('error_description') || hash.get('error')
  if (!raw) return
  const msg = decodeURIComponent(raw.replace(/\+/g, ' '))
  // A failed verification is most often a cross-browser/expired link — give the
  // actionable hint rather than the raw provider string.
  const code = query.get('error_code') || hash.get('error_code') || ''
  toast(
    /otp|expired|invalid|access_denied/i.test(`${code} ${msg}`)
      ? 'That sign-in link didn’t work — open it in the same browser you started from, or request a new one.'
      : msg,
    'danger',
  )
  for (const k of ['error', 'error_code', 'error_description']) {
    query.delete(k)
    hash.delete(k)
  }
  const q = query.toString()
  const h = hash.toString()
  window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + (h ? `#${h}` : ''))
}

/** Call once at startup: hydrate session + subscribe to auth changes. */
export function initAuth(): void {
  if (!supabase) return
  reportAuthErrorFromUrl()
  void supabase.auth.getSession().then(({ data }) => applySession(data.session))
  supabase.auth.onAuthStateChange((_event, session) => applySession(session))
}
