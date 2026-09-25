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
export const LAST_UPDATED = '25 September 2026'

/** Third-party services that process data on Manim's behalf. Enumerated in the
 *  privacy policy (the audit's L8) so the sub-processor posture is disclosed. */
export const SUBPROCESSORS: { name: string; purpose: string }[] = [
  { name: 'LiveKit Cloud', purpose: 'Real-time audio/video transport for calls.' },
  { name: 'Supabase', purpose: 'Accounts, profiles, contacts, and call signalling.' },
  { name: 'Cloudflare', purpose: 'Hosting, content delivery, and rate limiting.' },
  { name: 'Resend / Brevo', purpose: 'Sending sign-in codes and email invites.' },
  { name: 'Google', purpose: 'Optional "Continue with Google" sign-in.' },
  {
    name: 'Giphy and Tenor',
    purpose:
      'GIF search when you open the picker, and GIFs anyone posts in chat, which load for everyone in the call. They see your IP address.',
  },
  {
    name: 'jsDelivr and Google Cloud Storage',
    purpose: 'Background-blur model files, downloaded by your browser only when you turn blur on.',
  },
  { name: 'Krisp (through LiveKit)', purpose: 'Noise suppression, processed in your browser.' },
]

/** The data Manim collects, and why — the core of the privacy disclosure (L1). */
export const DATA_COLLECTED: { what: string; where: string; why: string }[] = [
  {
    what: 'Display name & a device id',
    where: 'Your browser (local storage), and shown to the people in each call you join',
    why: 'So returning users skip re-typing their name; the device id tells your devices apart and powers multi-device handoff.',
  },
  {
    what: 'Recent rooms and their links',
    where: 'Your browser (local storage), for 30 days',
    why: 'So you can rejoin a meeting from the home screen. Signing out clears them.',
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
    where: 'Processed in transit (not stored against your account); invites are sent through Resend',
    why: 'When you call or invite someone by email, we look up their account or email them an invite.',
  },
  {
    what: 'Room name and when it was last used',
    where: 'Our edge storage (Cloudflare), for up to a year',
    why: 'So an invite link that has been unused for 30 days expires instead of reopening an old room.',
  },
  {
    what: 'Your IP address',
    where: 'Processed transiently at our edge (Cloudflare)',
    why: 'Abuse prevention / rate limiting on join and invite endpoints. Not stored as a profile.',
  },
]
