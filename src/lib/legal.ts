/**
 * Single source of truth for the user-facing legal/operational surfaces
 * (privacy policy, terms, footer). Centralised so the operator contact and the
 * provider list are edited in ONE place. `public/.well-known/security.txt` is a
 * static file and carries its own copy of the contact address: keep them in step.
 *
 * The policy/terms text is an honest description of what the code actually does,
 * not legal advice — have counsel review it for the jurisdictions you operate in
 * (which laws apply depends on where you and your users are). When the code
 * changes what happens to someone's data, change the page in the same PR.
 */

export const APP_NAME = 'Manim'

/** Operator contact for privacy, deletion, abuse, and security disclosure. */
export const CONTACT_EMAIL = 'bismarkgyau@gmail.com'

/** Youngest age allowed to use Manim (the GDPR default for consenting alone). */
export const MIN_AGE = 16

/** Shown on the policy/terms pages so users know how current the text is. */
export const LAST_UPDATED = '26 September 2026'

/** The services Manim uses that handle people's data. Enumerated in the privacy
 *  policy (the audit's L8). Giphy/Tenor and Google sign-in are independent
 *  services rather than processors acting for Manim, so the heading says "services
 *  we use", not "sub-processors". */
export const SUBPROCESSORS: { name: string; purpose: string }[] = [
  {
    name: 'LiveKit Cloud',
    purpose:
      'Carries every call through its servers: audio, video, screen share, chat, files, drawings, names and account numbers. On end-to-end-encrypted calls it can’t see or hear the audio and video, but it can read everything else.',
  },
  { name: 'Supabase', purpose: 'Accounts, profiles, photos, contacts, and ringing your devices.' },
  { name: 'Cloudflare', purpose: 'Hosting the app, and rate limiting joins and invites.' },
  { name: 'Resend', purpose: 'Sending email invites. It keeps a delivery record of each one.' },
  { name: 'Brevo (through Supabase)', purpose: 'Sending sign-in codes.' },
  {
    name: 'Google',
    purpose: 'Optional “Continue with Google” sign-in. It shares your name, email and photo with us.',
  },
  {
    name: 'Your browser’s push service (Google, Mozilla or Apple)',
    purpose: 'Delivers the “incoming call” alert when you’ve turned notifications on. It sees no call details.',
  },
  {
    name: 'Giphy and Tenor',
    purpose:
      'GIF search when you open the picker, and GIFs anyone posts in chat, which load for everyone in the call. They see your IP address.',
  },
  {
    name: 'jsDelivr and Google Cloud Storage',
    purpose:
      'Background-blur model files, downloaded by your browser whenever blur is on. Blur stays on for later calls until you turn it off.',
  },
  { name: 'Krisp (through LiveKit)', purpose: 'Noise suppression, processed in your browser.' },
  {
    name: 'Sentry',
    purpose:
      'Crash reports, if they’re switched on: the error, the page address and room name, and your browser and device type. The join secret and encryption key are removed from links before a report leaves your browser.',
  },
]

/** The data Manim collects, and why — the core of the privacy disclosure (L1). */
export const DATA_COLLECTED: { what: string; where: string; why: string }[] = [
  {
    what: 'Display name & a device id',
    where: 'Your browser (local storage), and shown to the people in each call you join',
    why: 'So you don’t retype your name each time. The device id is random; it tells your devices apart so a call can move from one to another.',
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
    why: 'To show your contacts and let you call them. Anyone who knows your email can find out you have an account and send you a request; they see your name and photo while it’s pending. Once you accept, you each see the other’s email, name and photo.',
  },
  {
    what: 'Notification subscription',
    where: 'Your account (Supabase), if you enable notifications',
    why: 'To ring your device when someone calls while the tab is closed. Notifications carry no message content.',
  },
  {
    what: "Another person's email",
    where: 'Used once, not stored against your account; invite emails go through Resend',
    why: 'When you call or invite someone by email, we look up their account or email them an invite. The email shows your name and the room name.',
  },
  {
    what: 'Room name and when it was last used',
    where: 'Cloudflare, for up to a year after it was last joined (rooms opened from an invite link only)',
    why: 'So an invite link that has been unused for 30 days expires instead of reopening an old room.',
  },
  {
    what: 'Your IP address',
    where: 'Seen by every service your browser connects to (listed below)',
    why: 'We use it at Cloudflare only to rate-limit joining and invites, and we don’t store it.',
  },
]
