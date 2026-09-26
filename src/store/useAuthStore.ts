import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { avatarObjects } from '@/lib/avatarObjects'
import { supabase, getSupabase, authEnabled } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { toast } from '@/store/useToastStore'
import { squareDownscale } from '@/lib/image'
import { disablePush } from '@/lib/push'
import { forgetAuthSession, forgetPersonalData } from '@/lib/localData'
import { forgetDeviceKey } from '@/lib/deviceKey'
import { registerDeviceKey, unregisterDeviceKey } from '@/features/calls/deviceKeys'

/** Public Storage bucket holding user avatars (see DEPLOY.md §4a). */
const AVATAR_BUCKET = 'avatars'

/**
 * After sign-out / account deletion: forget this person (lib/localData) and start
 * the page over. A reload is the one reset every store honours — the device id,
 * recents, contacts and notification state are all read from storage at startup,
 * so patching each in memory would be a list that goes stale the day a store is
 * added.
 */
function leaveThisBrowser(): void {
  forgetPersonalData()
  forgetAuthSession()
  window.location.assign('/')
}

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
  /** Permanently delete the signed-in account: a SECURITY DEFINER RPC removes the
   *  `auth.users` row, which cascades to profiles/contacts/push_subscriptions
   *  (see DEPLOY.md §4c). Then drops back to a guest session locally. */
  deleteAccount: () => Promise<void>
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
    const sb = await getSupabase()
    if (!sb) throw new Error('Sign-in is not configured.')
    const { error } = await sb.auth.signInWithOtp({
      // Return to the EXACT page sign-in started from (e.g. /r/standup), not the
      // bare origin — otherwise a user who signs in mid-join lands on / and has to
      // re-navigate. The room's #fragment (its join secret and E2EE key) stays
      // behind: this goes to Supabase and into the email, and the sign-in round
      // trip replaces the fragment anyway — lib/roomKeys puts it back from this
      // browser's memory when you land.
      email,
      options: { emailRedirectTo: returnUrl() },
    })
    if (error) throw error
  },
  verifyEmailOtp: async (email, token) => {
    const sb = await getSupabase()
    if (!sb) throw new Error('Sign-in is not configured.')
    // type 'email' covers the OTP token from a signInWithOtp email. On success the
    // onAuthStateChange listener (initAuth) applies the session — no extra wiring.
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' })
    if (error) throw error
  },
  signInWithGoogle: async () => {
    const sb = await getSupabase()
    if (!sb) throw new Error('Sign-in is not configured.')
    // Redirects to Google, then back to the page sign-in started from, where
    // onAuthStateChange (initAuth) picks up the session. Requires the Google
    // provider enabled in the Supabase dashboard (OAuth client id/secret) — see
    // DEPLOY.md. (The exact return URL must be in Supabase's allow-list.)
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: returnUrl() },
    })
    if (error) throw error
  },
  signOut: async () => {
    // Push rows are deletable only by their owner (RLS), so unsubscribe while the
    // session still exists — after sign-out this browser would keep ringing for
    // an account nobody here is signed into.
    await disablePush()
    const sb = await getSupabase()
    // Same for this browser's sealing key: nobody should keep sealing call keys to
    // a device that's no longer signed in.
    const { signedIn, userId } = get()
    if (sb && signedIn) await unregisterDeviceKey(sb, userId).catch(() => {})
    await forgetDeviceKey().catch(() => {})
    // Offline or mid-outage this fails and keeps the session; leaveThisBrowser
    // drops it regardless.
    if (sb) await sb.auth.signOut().catch(() => {})
    leaveThisBrowser()
  },

  deleteAccount: async () => {
    const sb = supabase
    const { signedIn, userId } = get()
    if (!sb || !signedIn) throw new Error('Sign in to delete your account')
    // The photo is a public object and isn't covered by the account's cascade, so
    // it outlived the account. Best-effort, before the row goes.
    await sb.storage.from(AVATAR_BUCKET).remove(avatarObjects(userId, get().avatarUrl)).catch(() => {})
    await disablePush()
    // The DB function deletes the caller's own auth.users row (auth.uid()); the
    // on-delete-cascade FKs take profiles/contacts/push_subscriptions with it.
    const { error } = await sb.rpc('delete_account')
    if (error) throw new Error('Couldn’t delete your account — try again')
    // The user no longer exists — clear the (now invalid) session and drop to guest.
    // (Their device_keys rows went with the cascade; the private key is local.)
    await forgetDeviceKey().catch(() => {})
    await sb.auth.signOut().catch(() => {})
    leaveThisBrowser()
  },

  uploadAvatar: async (file) => {
    const sb = supabase
    const { signedIn, userId } = get()
    if (!sb || !signedIn) throw new Error('Sign in to add a photo')

    // Shrink + square-crop in the browser so we store a few-KB webp, not the
    // original multi-MB photo. The bucket is public and account ids are visible to
    // everyone in a call, so a fixed `<id>/avatar.webp` let anyone who'd been in a
    // call with you open your photo forever. A random name is only reachable
    // through the URL the account row hands out; each upload is a new name, which
    // also busts the CDN cache.
    const blob = await squareDownscale(file)
    const path = `${userId}/${crypto.randomUUID()}.webp`
    const { error: upErr } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(path, blob, { upsert: false, contentType: 'image/webp' })
    if (upErr) throw new Error('Couldn’t upload your photo — try again')

    const url = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
    const previous = avatarObjects(userId, get().avatarUrl)
    const { error: rowErr } = await sb.from('profiles').upsert({ id: userId, avatar_url: url })
    if (rowErr) {
      // The account still points at the old photo: keep it, drop the new one.
      await sb.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {})
      throw new Error('Couldn’t save your photo — try again')
    }
    set({ avatarUrl: url })
    // The old photo (and the legacy fixed-name one) go once the row points away.
    await sb.storage.from(AVATAR_BUCKET).remove(previous.filter((o) => o !== path)).catch(() => {})
  },

  removeAvatar: async () => {
    const sb = supabase
    const { signedIn, userId } = get()
    if (!sb || !signedIn) return
    // Best-effort delete of the Storage object (a provider-seeded OAuth URL has
    // none — ignore). Then null the account row so it doesn't re-seed.
    await sb.storage.from(AVATAR_BUCKET).remove(avatarObjects(userId, get().avatarUrl)).catch(() => {})
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

/** localStorage key recording which account the persisted display name + avatar
 *  belong to, so a sign-in as a DIFFERENT user can detect (and discard) the stale
 *  previous-user profile before the async sync resolves. */
const PROFILE_UID_KEY = 'manim-profile-uid'

function applySession(session: Session | null) {
  if (session?.user) {
    const uid = session.user.id
    // The display name is persisted device-wide and the avatar lingers in memory;
    // both belong to whoever was last signed in. If that's a DIFFERENT account than
    // the one now signing in, seed name + avatar from this session synchronously so
    // the previous user doesn't flash on screen before syncProfile (async) resolves.
    // Same user (or first-ever sign-in) keeps the persisted value to avoid a
    // provider-name→account-name flash.
    const known = localStorage.getItem(PROFILE_UID_KEY)
    const differentUser = known !== null && known !== uid
    localStorage.setItem(PROFILE_UID_KEY, uid)
    // Before signedIn flips, so presence (which waits on it) sees this call.
    if (supabase) void registerDeviceKey(supabase, uid, differentUser)
    useAuthStore.setState({ userId: uid, email: session.user.email ?? null, signedIn: true })
    if (differentUser) {
      useAuthStore.setState({ avatarUrl: avatarFromSession(session) || null })
      useAppStore.getState().setDisplayName(nameFromSession(session), false)
    }
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

/** Where a sign-in returns to: this page, without its #fragment (see signInWithEmail). */
function returnUrl(): string {
  return location.origin + location.pathname + location.search
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
    // Only fixed strings: the URL is attacker-controllable, and the provider's
    // text is written for developers.
    /otp|expired|invalid|access_denied/i.test(`${code} ${msg}`)
      ? 'That sign-in link didn’t work — open it in the browser you started in, or request a new one'
      : 'Couldn’t sign you in — request a new link',
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
  if (!authEnabled) return
  reportAuthErrorFromUrl()
  void getSupabase().then((sb) => {
    if (!sb) return
    void sb.auth.getSession().then(({ data }) => applySession(data.session))
    sb.auth.onAuthStateChange((_event, session) => applySession(session))
  })
}
