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
- [ ] **Email invites only reach you** (deferred, Sept 2026: needs a domain).
      `RESEND_FROM` is Resend's test sender (`onboarding@resend.dev`), which
      delivers only to the Resend account owner, and a `workers.dev` address can't
      be verified. With a domain: verify it in Resend and point `RESEND_FROM` at it,
      and move the Supabase sign-in sender (Brevo, currently a Gmail address, which
      can land in spam) onto it too. Until then guests get the mail-app fallback.
- [ ] `VAPID_SUBJECT` must be a Worker **Secret**, not a plain variable (Sept 2026 it
      was added as a variable, which the next deploy from `wrangler.toml` wipes).
- [ ] Confirm crash reports arrive: the DSN and scrubbing rule are set (Sept 2026);
      run DEPLOY.md §3c step 6 in a browser without an ad blocker (they block
      Sentry's loader, which is also why some visitors will never report).
- [ ] Run the new SQL (Sept 2026 batch): the `avatar read own` policy (§3a), the
      push `seen_at` column and trigger (§4c), and the nightly clean-up jobs (§4d).

## Areas not yet audited

- [ ] **Accessibility: the screen-reader walk.** The code-level pass is done (focus
      returns on close, Escape stays in the composer, landmarks, honest toggle
      states, announcements, switchable one-key shortcuts). What's left needs a
      real screen reader: `docs/screen-reader-check.md` (~15 minutes). Live
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

- [ ] **The E2EE key through Supabase.** It still passes through Supabase when
      ringing a contact (`features/calls/calls.ts`) and in cross-device presence
      (`features/calls/usePresence.ts`). Encrypt it per recipient device.
      (Chat, files, drawings and reactions are end-to-end encrypted on an
      encrypted call since Sept 2026, and so is a merge's key.)
- [ ] **Forgeable chat state.** Pins and history replay relay other people's
      messages, so the author and text are whatever the relayer says. Needs signed
      messages to fix properly. (Report notices now name the verified sender.)
- [ ] Merging an UNENCRYPTED call into an encrypted one still sends the target's
      key over a channel LiveKit can read (disclosed on the Privacy page).
- [ ] Participants' account id is visible to everyone in every call (participant
      metadata), which links you across calls. It feeds photos and the
      same-account-on-another-device check, so a per-room value needs those to
      move server-side. (The device id is already per call.)

## Experience

- [ ] Landing brand touches the Setup pill on a 375×667 phone (dev and `?setup` only
      now: visitors no longer see the pill).

## Performance

- [ ] The prejoin mic meter opens its own microphone capture next to the video
      preview's. Kept on purpose for now: one combined capture would restart the
      video (a visible flicker) every time the mic is toggled. Revisit only if a
      real device shows the second capture failing.

## Redundancy

- [ ] Noise suppression appears in three places; on touch, device choice has two
      routes to one dialog. A design call: check Mobbin before collapsing.

## Product ideas

- Device pickers on prejoin, with the speaker test using the chosen output.
- The end-of-call screen could add copy link and a one-tap rating.
- Room readiness before joining ("Host hasn't joined yet", "3 people in the call").
- A lobby that isn't a dead end (live preview, editable name, note to the host).
- Honest connection states (offline detection, reconnect timer, Keep trying/Leave).
- Short, speakable join codes alongside secure links.
- A permanent encryption indicator in TopStack.
