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

## Needs doing outside the code

- [ ] **Run the SQL in DEPLOY.md §3.1 once** in the Supabase SQL editor. The app
      already handles the throttled response; until the SQL runs there is no limit.
- [ ] **Deploy when no important calls are live.** Seat keys start working on deploy;
      someone already in a call who reloads afterwards has no key for their seat and
      is asked to change their name (a host rejoins as a guest). Once only.
- [ ] Have counsel read the updated Privacy page.

## Areas not yet audited

- [ ] **Accessibility in real use.** Walk a whole call keyboard-only and with a
      screen reader (VoiceOver, NVDA). Decide on live captions for deaf and
      hard-of-hearing guests. Automated axe checks already run in CI.
- [ ] **Real devices and bad networks.** Real iPhone Safari, a low-end Android, a
      weak or lossy connection. Best done locally, on your own devices.
- [ ] **Words and voice.** One tone across copy, errors and empty states; remove
      developer-facing text from production (e.g. "restart the dev server").
- [ ] **Product analytics.** A privacy-respecting view of what's used and where
      people drop out of the join flow, so keep/cut calls have data.
- [ ] **Cost and scale.** Model LiveKit participant-minutes against growth; the
      quota cap is a product risk, not just a testing one.

## Security

- [ ] **End-to-end encryption, properly.** The key still passes through Supabase
      when ringing a contact (`features/calls/calls.ts`) and in cross-device
      presence (`features/calls/usePresence.ts`). Encrypt it per recipient. Also
      move to livekit-client's `encryption` option so chat, files and drawings are
      end-to-end encrypted too (`lib/livekit.ts` uses the legacy `e2ee`).
- [ ] **"Remove from call" isn't permanent.** A removed person can knock straight
      back in. Keep a per-room removed list on the server, checked at knock.
- [ ] **Host election grace period.** A host who drops for seconds can lose the room
      for good (`handleElectHost`). Wait ~60s before electing.
- [ ] **Forgeable chat state.** Pins, history replay and "report" notices take the
      sender's name from the message. Attribute to the verified sender.
- [ ] Hardening: narrow CSP `script-src` from all of jsDelivr to the MediaPipe path;
      rate-limit `/api/push`; show only fixed strings for auth errors from the URL.
- [ ] **Switch crash reporting on.** The CSP now allows Sentry's loader; set
      `VITE_SENTRY_DSN` in the Cloudflare build and keep Session Replay and
      tracing off in Sentry's Loader Script settings (steps in DEPLOY.md).
- [ ] Merging calls sends the target room's E2EE key over the call's data channel,
      which LiveKit can read (disclosed on the Privacy page). Fixed by the
      per-recipient encryption item above.
- [ ] Participants' persistent device id and account id are visible to everyone in
      every call (identity + metadata + waiting-room queue). Use a per-room hash.

## Experience

- [ ] **"Call ended" screen** with the reason (host ended, removed, connection lost,
      everyone left) plus Rejoin and Home. Today people land on the home page.
- [ ] **Solo auto-leave**: add "Keep call open", or ask "Still there?".
- [ ] **Encryption failure** should be a persistent pill in TopStack, and toasts
      should move into TopStack so the layering rules cover them.
- [ ] Hide the random code in generated room titles in-app and in Recents (the link
      preview already does).
- [ ] Room URLs are case-sensitive (`/r/Team` vs `/r/team`). Redirect to lowercase.
- [ ] "Start a new meeting" on the expired-link screen only goes home.
- [ ] Join is disabled with no hint when the name is empty.
- [ ] Prejoin mic/camera choices aren't remembered between visits.
- [ ] Landing brand touches the Setup pill on a 375×667 phone.
- [ ] Firefox's own PiP button appears on hover over tiles.
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
- A proper end-of-call moment (reason, Rejoin, copy link, one-tap rating).
- Room readiness before joining ("Host hasn't joined yet", "3 people in the call").
- A lobby that isn't a dead end (live preview, editable name, note to the host).
- Honest connection states (offline detection, reconnect timer, Keep trying/Leave).
- Short, speakable join codes alongside secure links.
- A permanent encryption indicator in TopStack.
