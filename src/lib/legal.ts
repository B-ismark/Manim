/**
 * Single source of truth for the user-facing legal/operational surfaces
 * (privacy policy, terms, footer, security.txt). Centralised so the operator
 * contact and sub-processor list are edited in ONE place.
 *
 * NOTE FOR THE OPERATOR: set CONTACT_EMAIL to a real inbox you monitor before
 * deploying — it's the address users reach for deletion/abuse/security requests
 * (privacy policy, terms, and /.well-known/security.txt all point at it). The
 * policy/terms text below is an honest description of what the code actually
 * does, not legal advice — have counsel review it for the jurisdictions you
 * operate in (which laws apply depends on where you and your users are).
 */

export const APP_NAME = 'Manim'

/** Operator contact for privacy, deletion, abuse, and security disclosure. */
export const CONTACT_EMAIL = 'privacy@manim.app'

/** Shown on the policy/terms pages so users know how current the text is. */
export const LAST_UPDATED = '19 June 2026'

/** Third-party services that process data on Manim's behalf. Enumerated in the
 *  privacy policy (the audit's L8) so the sub-processor posture is disclosed. */
export const SUBPROCESSORS: { name: string; purpose: string }[] = [
  { name: 'LiveKit Cloud', purpose: 'Real-time audio/video transport for calls.' },
  { name: 'Supabase', purpose: 'Accounts, profiles, contacts, and call signalling.' },
  { name: 'Cloudflare', purpose: 'Hosting, content delivery, and rate limiting.' },
  { name: 'Resend / Brevo', purpose: 'Sending sign-in codes and email invites.' },
  { name: 'Google', purpose: 'Optional "Continue with Google" sign-in.' },
  { name: 'Giphy', purpose: 'GIF search in chat (only when you open the picker).' },
  { name: 'MediaPipe CDN (jsDelivr)', purpose: 'Background-blur model files, loaded in your browser.' },
]

/** The data Manim collects, and why — the core of the privacy disclosure (L1). */
export const DATA_COLLECTED: { what: string; where: string; why: string }[] = [
  {
    what: 'Display name & a device id',
    where: 'Your browser (local storage)',
    why: 'So returning users skip re-typing their name; the device id powers multi-device handoff.',
  },
  {
    what: 'Email, display name, profile photo',
    where: 'Your account (Supabase), if you sign in',
    why: 'To identify your account and sync your name/photo across your devices.',
  },
  {
    what: 'Your contacts',
    where: 'Your account (Supabase)',
    why: 'To show your saved contacts and let you call them. Adding someone requires their consent.',
  },
  {
    what: 'Push subscription (a device identifier)',
    where: 'Your account (Supabase), if you enable notifications',
    why: 'To ring your device when someone calls while the tab is closed. Notifications carry no message content.',
  },
  {
    what: "Another person's email",
    where: 'Processed in transit (not stored against your account)',
    why: 'When you call or invite someone by email, we look up their account or email them an invite.',
  },
  {
    what: 'Your IP address',
    where: 'Processed transiently at our edge (Cloudflare)',
    why: 'Abuse prevention / rate limiting on join and invite endpoints. Not stored as a profile.',
  },
]
