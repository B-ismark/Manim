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
Oct–Nov 2026: contact device keys remembered and changes asked about before a ring
(`lib/devicePins`, `KeyChangeDialog`), per-room account pseudonyms in place of the
account id, the phone landing header, one touch route to device choice, and the
product ideas for the end screen (copy link, rating), room readiness, a lobby that
isn't a dead end and honest reconnecting. Nov 2026: the toolchain and runtime
upgrade (Node 24, Vite 8, TypeScript 7, Express 5, Vitest 5, Krisp 0.4, a newer
Workers compatibility date) and the People chip's label, which a screen-reader
user could not say aloud to voice control.

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

- [ ] **The rest of who vouches for a device key.** Rings now remember a contact's
      keys and ask before sealing to anything new (`lib/devicePins`). Still open:
      "Ring anyway" on the nothing-to-seal-to prompt sends the key unsealed; a pin
      check that throws skips the prompt (`calls.ts`, `.catch(() => null)`); a
      contact never rung before with no devices is sent unsealed silently; and the
      other-device offer (`usePresence` → `secretsFor`) still falls back on a failed
      lookup and never pins your own devices. The Privacy page describes this today.
- [ ] **Forgeable chat state.** Pins and history replay relay other people's
      messages, so the author and text are whatever the relayer says. Needs signed
      messages to fix properly. (Report notices now name the verified sender.)
- [ ] Merging an UNENCRYPTED call into an encrypted one still sends the target's
      key over a channel LiveKit can read (disclosed on the Privacy page).
- [ ] **Someone who leaves keeps the call key.** There is no re-key when people
      leave or are removed, so they could still decode later media if they can
      reach it (`lib/roomLink.ts`, "KNOWN LIMITATION").
- [ ] **The call-wide tag proves membership, not authorship.** Host controls, ink and
      reactions are tagged with the shared key (`lib/dataTag.ts`), so any member
      can speak as another and the server can replay a packet. Wider than the
      chat item above; the same signed-messages fix covers both.

## Experience

- [ ] The landing collision test never runs at 375×667: `01-landing` runs on the
      desktop and Pixel 7 projects, and `mobile-sm` runs only `11-mobile-fit`. The
      header is fixed for phones; this is the guard that would catch it returning.
- [ ] Encryption isn't always visible. The padlock sits in the status pill, which
      hides with the chrome; only a failed-encryption pill stays.

## Performance

- [ ] The prejoin mic meter opens its own microphone capture next to the video
      preview's. Kept on purpose for now: one combined capture would restart the
      video (a visible flicker) every time the mic is toggled. Revisit only if a
      real device shows the second capture failing.

## Redundancy

- [ ] Noise suppression still appears in three components, so desktop shows it twice
      (the mic caret and More → Audio & video). Touch is down to one route. A design
      call: check Mobbin before collapsing.

## Product ideas

- Device pickers on prejoin, with the speaker test using the chosen output.
- Short, speakable join codes alongside secure links.

## Upkeep

- [ ] `@playwright/test` is held at 1.61 in the lockfile on purpose: the visual
      baselines were drawn with its browser. Bump it together with a re-baseline
      of `09-visual`.
- [ ] The Workers compatibility date stops at 2026-11-01. The flags dated after it
      (a new module registry, request abort signals, back-pressure in `pipeTo`, and
      `cache` keeping Cache-Control) need their own look before moving past it.
- [ ] The low-bandwidth workflow (`.github/workflows/lowbw.yml`) runs
      `npm run test:lowbw`, which doesn't exist, so it can't pass. Add the spec
      and script, or retire the workflow.
