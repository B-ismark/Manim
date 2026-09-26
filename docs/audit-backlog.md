# Audit backlog

The open items from the September 2026 platform audit, so they outlive the session
that found them. Each line says what people experience and, where it's known, where
to start. Tick an item off by deleting it in the PR that fixes it.

Fixed in the audit itself (see the PR for details): the browser's video menu on live
feeds, the always-mirrored preview, host takeover via a copied identity (seat keys),
waiting-room claim, email-invite phishing, chat image tracking pixels, host-only
drawing, name limits, react-router CVEs, device failures ending the join, the black
preview after a failed join, toasts, iOS input zoom, tile gestures, RTL text, link
previews, sign-out leaving data behind, error-report scrubbing, the privacy policy's
encryption claims, the chat-history host setting, the find-by-email throttle, and
(from the review of all that) call data channels that rebuilt on every render, a
"need the full link" screen for guests who arrive at an encrypted call without its
key, and a Worker crash on returning visitors that never reached production.
Words and voice (Sept 2026): one voice across the app, no developer text in front
of people (see that PR).

## Needs doing outside the code

- [ ] **Deploy when no important calls are live.** Seat keys start working on deploy;
      someone already in a call who reloads afterwards has no key for their seat and
      is asked to change their name (a host rejoins as a guest). Once only.
- [ ] Have counsel read the updated Privacy page. Still missing and theirs to decide:
      the legal basis for each use and the safeguards for data processed in the US.
      The page deliberately names no operator (owner's choice); counsel should
      confirm that's acceptable where you operate. Minimum age is 16.
- [ ] Confirm Brevo is the sign-in email sender configured in Supabase (the Privacy
      page lists it). Without custom SMTP, Supabase only emails the project team.
- [ ] **Email invites only reach you.** `RESEND_FROM` is Resend's test sender
      (`onboarding@resend.dev`), which delivers only to the Resend account owner.
      Verify a domain you own in Resend and point `RESEND_FROM` at it. Until then
      guests get the mail-app fallback, which works.
- [ ] Set `VAPID_SUBJECT` as a Worker **Secret** (`mailto:` your address). It left
      `wrangler.toml` because the repo is public; unset, push uses the repo URL.
- [ ] Update the Sentry advanced scrubbing rule to the one in DEPLOY.md §3c (it now
      also catches a token in a query string).

## Areas not yet audited

- [ ] **Accessibility: the screen-reader walk.** The code-level pass is done (focus
      returns on close, Escape stays in the composer, landmarks, honest toggle
      states, announcements, switchable one-key shortcuts). What's left needs a
      real screen reader: `docs/screen-reader-check.md` (~15 minutes). Still open in
      code: the desktop control bar doesn't reflow at 320px (400% zoom), and on
      touch a message's actions are reachable only by tapping the bubble. Live
      captions: not for now (owner, Sept 2026).
- [ ] **Real devices and bad networks.** `docs/real-device-checklist.md`: iPhone
      Safari, a low-end Android, a weak or lossy connection, on your own devices.
- [ ] **Product analytics: decide.** `docs/analytics-proposal.md` recommends eight
      anonymous counters in the Worker (no cookies, no third party). One decision:
      anonymous counts, yes or no.
- [ ] **Cost and scale: decide the levers.** The model is `docs/cost-and-scale.md`
      (free plan everywhere). LiveKit's 5,000 participant-minutes a month is the
      first wall, at roughly 13 three-person half-hour calls a week. Product calls
      for you: default video quality, room size cap, and how soon a call ends when
      you're alone in it. Code levers still open: fewer KV writes per join, the
      host's 3-second waiting-room poll, static files counting as Worker requests.

## Security

- [ ] **End-to-end encryption, properly.** The key still passes through Supabase
      when ringing a contact (`features/calls/calls.ts`) and in cross-device
      presence (`features/calls/usePresence.ts`). Encrypt it per recipient. Also
      move to livekit-client's `encryption` option so chat, files and drawings are
      end-to-end encrypted too (`lib/livekit.ts` uses the legacy `e2ee`).
- [ ] **Forgeable chat state.** Pins and history replay relay other people's
      messages, so the author and text are whatever the relayer says. Needs signed
      messages to fix properly. (Report notices now name the verified sender.)
- [ ] Hardening: narrow CSP `script-src` from all of jsDelivr to the MediaPipe path;
      rate-limit `/api/push`.
- [ ] **Switch crash reporting on.** The CSP now allows Sentry's loader; set
      `VITE_SENTRY_DSN` in the Cloudflare build and keep Session Replay and
      tracing off in Sentry's Loader Script settings (steps in DEPLOY.md).
- [ ] Merging calls sends the target room's E2EE key over the call's data channel,
      which LiveKit can read (disclosed on the Privacy page). Fixed by the
      per-recipient encryption item above.
- [ ] Profile photos sit in a public bucket at `avatars/<account id>/avatar.webp`, and
      the account id is visible to everyone in a call, so anyone in a call with you
      can open your photo. Use an unguessable object name (or a private bucket with
      signed URLs); account deletion then needs the stored name.
- [ ] Waiting-room requests (name, device id, account id, denied ones too) stay in
      room metadata, visible to everyone in the call, until the room closes. Prune
      settled requests.
- [ ] Push endpoints that return 404/410 are never deleted (`server/core.mjs`
      push loop). Prune them.
- [ ] Pending contact requests never expire.
- [ ] Participants' persistent device id and account id are visible to everyone in
      every call (identity + metadata + waiting-room queue). Use a per-room hash.

## Experience

- [ ] **Encryption failure** should be a persistent pill in TopStack, and toasts
      should move into TopStack so the layering rules cover them.
- [ ] Landing brand touches the Setup pill on a 375×667 phone (dev and `?setup` only
      now: visitors no longer see the pill).
- [ ] Turning a camera back ON after another app took it fails silently: a muted
      track re-acquires via `unmute()` → `restart()`, which never raises LiveKit's
      `MediaDevicesError` (`useMediaDeviceWatch`), so no message and an unhandled
      rejection. Catch at the toggle call sites or wrap `setCameraEnabled`.
- [ ] Re-granting camera access in browser settings needs a reload
      (listen for `PermissionStatus` changes).
- [ ] Long toasts still overlap prejoin's Back label on a phone while they're up
      (part of moving toasts into TopStack, above).

## Performance

- [ ] **The whole call screen redraws on every speaker change**: `RoomView`,
      `useSessionControl` and `useApplyBlocks` listen to every participant update and
      nothing below is memoized. Narrow the listeners, move chat state down,
      memoize ControlBar and Stage. Biggest remaining win, especially on phones.
- [ ] Supabase (~40–50 KB gz) loads before the landing page renders, even for guests.
- [ ] Opening the side panel re-packs the gallery on every animation frame.
- [ ] The prejoin mic meter opens a second microphone capture.
- [ ] Frosted pills over live video re-blur every frame on low-end phones.
- [ ] The font stack names Inter but never loads it.

## Redundancy

- [ ] Noise suppression appears in three places; on touch, device choice has two
      routes to one dialog. Check Mobbin before collapsing.
- [ ] Two fullscreen implementations (`Stage.tsx` vs `lib/useFullscreen.ts`); a bug
      has already come from them drifting.
- [ ] Two copy-link hooks; two device pickers that disagree about a success toast;
      three near-identical toggle rows; seven copies of the over-video button style;
      five copies of the chat long-press row style.
- [ ] Control-bar auto-hide has two mechanisms (`setChromeHold` and `overlayOpen()`).
- [ ] Move point-in-time audits and prototypes in `docs/` and `audit/` to
      `docs/archive/`.

## Product ideas

- Device pickers on prejoin, with the speaker test using the chosen output.
- The end-of-call screen could add copy link and a one-tap rating.
- Room readiness before joining ("Host hasn't joined yet", "3 people in the call").
- A lobby that isn't a dead end (live preview, editable name, note to the host).
- Honest connection states (offline detection, reconnect timer, Keep trying/Leave).
- Short, speakable join codes alongside secure links.
- A permanent encryption indicator in TopStack.
