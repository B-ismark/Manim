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
of people (see that PR). Later in Sept 2026: rings and the other-device offer carry
the call's key locked to the recipient's devices, anonymous usage counts
(`docs/usage-counts.md`), and a quota pass (static files off the Worker, no 3s
waiting-room poll, far fewer KV writes and Supabase/Sentry calls).

## Needs doing outside the code

- [ ] **Deploy when no important calls are live.** Seat keys start working on deploy;
      someone already in a call who reloads afterwards has no key for their seat and
      is asked to change their name (a host rejoins as a guest). Once only.
- Not planned (owner, Sept 2026: a private beta among friends): a counsel read of
  the Privacy page (legal basis per use, US-processing safeguards, naming no
  operator, minimum age 16). Revisit before opening it up.
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
      push `seen_at` column and trigger (§4c), the nightly clean-up jobs (§4d), and
      the device keys for sealed rings (§4e, after §4c). Until §4e runs, rings work
      the old way.
- [ ] After the deploy, check the served site: a file under `/assets/` answers with the
      COOP/COEP/CSP headers, and a call page
      still reports `crossOriginIsolated` true in the console.

## Areas not yet audited

- [ ] **Real devices and bad networks** (owner, later). `docs/real-device-checklist.md`:
      iPhone Safari, a low-end Android, a weak or lossy connection, on your own devices.
- [ ] **Cost and scale.** The model is `docs/cost-and-scale.md` (free plan
      everywhere). LiveKit's 5,000 participant-minutes a month is the first wall.
      Video quality stays as is (owner, Sept 2026); room size cap and how soon a
      call ends when you're alone in it are still yours to call. The code levers
      are done.
- Not planned (owner, Sept 2026): the screen-reader walk (`docs/screen-reader-check.md`
  is there if that changes) and live captions.

## Security

- [ ] **Who vouches for a device key.** Rings are sealed to the keys Supabase hands
      out (`features/calls/deviceKeys.ts`), so Supabase itself could swap one in, and
      a lookup that fails twice sends the key unsealed so the call still gets
      through. Fix: remember each contact's device keys the first time and warn on
      a change, and never fall back once keys have been seen.
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
