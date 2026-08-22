# UI/UX & Flow Audit — Manim — 2026-08-22

Report only — no code changed. Method: full static walkthrough of every route,
island, primitive, and style token (`src/routes`, `src/islands`, `src/components/primitives`,
`src/styles/app.css`, `src/features/session|calls`), traced end-to-end through the
primary user flows against the contracts in [STYLE.md](../STYLE.md) and
[Architecture-Plan.md](../Architecture-Plan.md).

## Summary
- **High: 1**
- **Medium: 5**
- **Low: 9**

Headline: the **flow architecture is sound** — every screen has an exit, error
states are friendly and recoverable, progressive disclosure matches the STYLE.md
tiers, and all three prior UI findings checked (contacts load-error, mention
combobox ARIA, reduced-motion typing dots) are **confirmed fixed**. The one High
is a **ringing lifecycle gap**: an incoming call never expires, and on touch it
is a full-screen takeover with no missed-call semantics.

---

## Flow map (verified end-to-end)

```
Landing (/)
├─ Join by typed name / pasted link ─────────────► /r/:room (PreJoin)
├─ New meeting (mints secret+E2EE key) ──────────► /r/:room (PreJoin)
├─ Recents "Rejoin" / Other-device "Join" ───────► /r/:room (carries secrets)
├─ Contact "Call" (rings + joins) ───────────────► /r/:room
├─ Sign-in modal (email OTP / Google) ───────────► stays on Landing
├─ Settings (popover desktop / dialog touch) ────► profile·notify·theme·delete
├─ Setup status (banner if required cfg missing) ─► popover/dialog detail
└─ Footer ───────────────────────────────────────► /privacy · /terms

/r/:room
├─ PreJoin: preview·toggles·mic meter·name·low-bw·E2EE badge·share invite
│   ├─ Back ─────────────────────────────────────► /
│   ├─ Join now ── knock ─┬─ token ─────────────► CallRoom (JoiningScreen cover)
│   │                     ├─ pending ────────────► WaitingRoom lobby (poll 2s)
│   │                     │    ├─ approved ──────► CallRoom (+OS notify if hidden)
│   │                     │    ├─ denied ───────► error card on PreJoin
│   │                     │    └─ expired ──────► toast → PreJoin
│   │                     ├─ link_expired ───────► ExpiredLink dead-end screen
│   │                     └─ transient fail ─────► auto-retry ×3 (backoff) → error card
└─ CallRoom (in-call)
    ├─ Stage: solo / grid (paged) / speaker+filmstrip / phone 1-on-1
    ├─ Chrome: CallStatusBar (timer·E2EE·weak-net) · StageTopBar (people·exit-FS)
    ├─ Banners: Connection · WaitingRoom(admit) · Handoff · InCallIncoming(merge)
    │            Presenting pill · RaisedHand pill · PinCoachmark (once)
    ├─ SidePanel sheet/dock: Chat (reply·edit·pin·react·files·GIF·mentions·typing)
    │                        People (invite·contacts·moderate·co-host·mute-all)
    ├─ More menu: reactions·PiP·fullscreen·lock·lobby·view(layout+density)·
    │             effects·A/V devices·self-view·videos-first·audio-only·settings
    └─ Exits: Leave(+8s undo-rejoin) · End-for-everyone(host,confirm) ·
              host-end broadcast · merge nav · solo-auto-leave(5min) · PiP handoff
```

No dead ends were found on any main path; every destructive action either
confirms (end-all, remove) or undoes (leave→rejoin toast).

---

## Findings

### [HIGH] Incoming-call ring never expires — indefinite full-screen takeover on touch
**Files:** `src/features/calls/calls.ts` (`useIncomingCalls` → `setIncoming`, no timeout),
`src/islands/IncomingCallBanner.tsx`
**Issue:** The ring broadcast sets `incoming` in the call store and nothing ever
clears it except user action. On touch the banner is a **full-screen overlay**
(`fixed inset-0`) that blocks navigation, settings, everything — until Accept or
Decline. There is no auto-miss timeout, no elapsed indicator, and no "missed
call" follow-up. Every phone platform auto-misses at ~30–45s; here a callee who
steps away returns hours later to a stale ringing screen, and a caller who gave
up has no way to retract (the caller joins the room immediately; the broadcast
is one-shot with no cancel event).
**Suggested fix:** Auto-expire `incoming` after ~45s (store-level timer or effect
in `useIncomingCalls`), surface a "Missed call from X" toast/notification on
expiry, and show a subtle elapsed cue on the overlay while it rings.

### [MEDIUM] More-menu toggles behave inconsistently (stay-open vs close)
**File:** `src/islands/ControlBar.tsx` (moreContent)
**Issue:** Within the *same* menu body: Lock/Lobby `GridTile`s do **not** call
`closeMore()` after toggling (menu stays open), while PiP/Full `GridTile`s do;
and MenuRow state-toggles (Hide self view, Show videos first, Audio-only) all
close the menu. Three control classes, two behaviors, no rule a user can learn.
**Suggested fix:** Pick one convention — recommend "state toggles stay open,
mode/window actions close" — and apply it uniformly (Lock/Lobby already match
the stay-open rule; make self-view/videos-first/audio-only stay open too, or
close everything).

### [MEDIUM] Landing header scrolls out of reach on small screens
**File:** `src/routes/Landing.tsx` (header `absolute inset-x-4 top-4` inside a
scrollable `<main>`)
**Issue:** With beta banner + other-device meetings + recents stacked above the
join card, content exceeds the viewport on small phones; scrolling moves the
`absolute` header off-screen, taking **Sign-in / Account, Contacts, Setup, and
Settings** with it. The scroll container was added deliberately (keyboard-safe
top-alignment), which makes this reachable in practice.
**Suggested fix:** Make the header `fixed` (it already has `z-20`; add the same
horizontal padding) so account/settings stay reachable while scrolled.

### [MEDIUM] Room-name input accepts URL-hostile characters into the slug
**File:** `src/routes/Landing.tsx` (`parseTyped`, `randomRoom` alphabet is clean
but typed names aren't sanitized)
**Issue:** Typed values only get lowercase + whitespace→dash. Characters like
`/ ? # % & +` flow into the slug. Two concrete harms: (1) secrets ride in the
URL **#fragment**, so a typed name containing `#` or `%` corrupts
`roomTo()`'s fragment encoding for the *generated* invite link; (2) slugs with
`/` produce odd double-segment-looking URLs and inconsistent room identity
between clients that decode differently.
**Suggested fix:** Strip to `[a-z0-9-]` (collapse repeats, trim dashes) inside
`parseTyped`/`goTo` — matching what `callContact` already does — and consider a
gentle inline hint when sanitization changes what the user typed.

### [MEDIUM] Dead component: `LayoutChip` violates the zero-orphan law
**File:** `src/islands/LayoutChip.tsx` — defined, **never imported anywhere**
(verified by project-wide search).
**Issue:** STYLE.md §3's anti-orphan gate governs shipped UI; an unwired island
file is the code-level equivalent. Either the top-chrome layout switcher it
implements was superseded by the unified View section in More (comments suggest
yes) and the file should be deleted, or it was meant to sit beside the
participants chip and the wiring was lost.
**Suggested fix:** Delete it, or wire it into `StageTopBar` if quick layout
switching at top-right is still desired (the More-menu View section currently
covers the need).

### [MEDIUM] Secondary touch targets fall short of platform minimums
**Files:** `src/routes/Landing.tsx` (recents remove button `size-7` = 28px),
various `size="sm"` buttons (~32px height) used for Admit/Deny, Invite, Rejoin.
**Issue:** Passes WCAG 2.5.8 (24px) but sits well under the 44px Apple HIG /
Material touch guideline. These are consequential actions (remove-from-recents,
admit/deny a human being) precisely where mis-taps hurt.
**Suggested fix:** Bump row-action hit areas to ≥40px via padding/negative
margin (visual size can stay small; expand the hit box), prioritizing the
recents remove and waiting-room Admit/Deny.

### [LOW] Toasts: no hover/focus pause; stack behavior unverified
**File:** `src/islands/Toasts.tsx`
**Issue:** `role="status"` + tone dots + action buttons are right, but the 4s
auto-dismiss keeps running while the user is reading/moving toward the action
button, and nothing visible caps the stack during join/leave bursts (they render
top-center where the status bar lives in-call).
**Suggested fix:** Pause the dismiss timer on pointerenter/focus-within; cap the
visible stack (e.g. 3 + "+n more") in the store.

### [LOW] HandoffBanner dismissal latches across repeat events
**File:** `src/islands/HandoffBanner.tsx`
**Issue:** `dismissed` is component state that persists for the session. If your
other device drops and rejoins later in the same call, `sameNameOther` flips
false→true again but the banner never re-shows — the "Use only this device"
affordance is silently gone exactly when it's relevant again.
**Suggested fix:** Reset `dismissed` when the condition transitions false→true
(small effect keyed on the boolean prop).

### [LOW] `color-scheme` declared but likely not driven by the theme store
**Files:** `index.html` (`<meta name="color-scheme" content="light dark">`),
`src/store/useThemeStore.ts` (not verified to set it)
**Issue:** The app forces light/dark via tokens, but native-rendered widgets
(color-picker popup in Custom theme, form autofill, scrollbars in some engines)
follow the OS/browser scheme unless `document.documentElement.style.colorScheme`
is set to match the active mode. Risk: mismatched native chrome in forced-dark.
**Suggested fix:** Set `colorScheme` alongside the token swap in the theme store
(one line per mode change).

### [LOW] Beta-gate probe race can dead-end a non-approved host
**File:** `src/routes/Landing.tsx` (`canHost` defaults `true` until `getMe` resolves)
**Issue:** The optimistic default avoids false blocking, but a fast tap on
"New meeting" before the probe lands sails past the landing guard and dies on
the in-room invite-only error card — the exact dead-end the gate was built to
prevent.
**Suggested fix:** While the probe is unresolved, disable New meeting with a
subtle "Checking…" affordance (or queue the intent and re-run the check on
resolution).

### [LOW] Waiting-room lobby gives no wait feedback
**File:** `src/routes/RoomRoute.tsx` (`WaitingRoom`)
**Issue:** Copy is honest ("The host has been notified") but there's no elapsed
timer or queue position, so a long wait feels unbounded and users can't tell a
stalled host from a broken poll. The 2s poll is invisible.
**Suggested fix:** Add a subtle "waiting X min" line (and optionally a "still
here?" nudge after N minutes that re-knocks).

### [LOW] Bulk host actions skip confirmation that single-target remove has
**File:** `src/islands/ParticipantsPanel.tsx` (`muteAll`)
**Issue:** "Remove from call" confirms; "Mute all"/"Stop video" fire instantly
across everyone. Blast radius argues for at least an undo toast ("Muted
everyone — Undo") rather than silence-to-confirmation asymmetry.
**Suggested fix:** Add an undo action to the mute-all/stop-video toasts (pattern
already exists: leave-with-undo).

### [LOW] Dark-mode contrast of accent-on-accent-soft chips (carry-over verify item)
**Files:** `src/islands/ChatPanel.tsx` (ReactionChips mine-state, mention
highlight), `src/routes/Landing.tsx` (OtherDeviceMeetings icon tile)
**Issue:** Carried from the 2026-06-17 audit (its LOW #4): `bg-accent-soft
text-accent` in dark mode mixes accent(L≈0.55) onto a dark soft surface —
estimated ~2:1 for the colored text/icon. Bordered/contextual usage mitigates;
an axe run in dark mode should settle it.
**Suggested fix:** Compute the real ratio; if short, introduce an
`accent-ink-soft` token or raise the soft mix — one token decision fixes all sites.

### [LOW] PreJoin mic meter can fire an unexplained second permission prompt
**File:** `src/islands/PreJoin.tsx` (`MicSpeakerTest` mounts when permission is
`'granted' | 'unknown'`)
**Issue:** On browsers without the Permissions API (older Safari), permission
stays `'unknown'`, so the mic-meter's own `getUserMedia({audio})` prompts the OS
without the rationale card (which only renders for `'prompt'`). Harmless but can
double-prompt right after the camera preview prompt.
**Suggested fix:** Gate `MicSpeakerTest` on an explicit user toggle, or fold its
request into the preview/priming acquisition.

### [LOW] Chat unpin constructs a synthetic ChatItem
**File:** `src/islands/ChatPanel.tsx` (`PinnedRow` → `togglePin({kind:'text', …fromIdentity:'', isLocal:false})`)
**Issue:** Works today because the store presumably keys off `id`, but the fake
row is a typing shim that will break silently if `togglePin` ever reads another
field.
**Suggested fix:** Add an id-based `unpin(id)` to the ChatApi.

---

## Verified-strong (checked, not findings)

**Flow integrity**
- Every surface has an exit: PreJoin→Back, lobby→Cancel, call→Leave/End, dialogs→Esc/scrim, FS→dedicated chip, PiP→Bring-back placeholder.
- Destructive-vs-recoverable split is deliberate: End-for-everyone and Remove confirm; plain Leave gets an 8s undo-rejoin toast; solo auto-leave warns 60s ahead.
- Merge/handoff orientation beats: participants get a toast explaining the room move; handoff banner explains echo risk.
- Host succession: "host left" announced once, deterministic server election, promotion toasts — no ghost-host freeze.
- ExpiredLink screen explains cause *and* both remedies (new meeting / ask for fresh link) instead of a bare error.

**Prior-audit fixes confirmed present**
- Contacts load-error surfaced + Retry wired (`Contacts.tsx` subscribes `error`).
- Mention picker full combobox ARIA (`role=combobox`, `aria-expanded/controls/activedescendant`, stable option ids).
- Reduced-motion typing dots fully static (dedicated override block in app.css).

**Accessibility**
- Radix primitives for every overlay (focus trap/restore/ARIA for free); global `:focus-visible` ring; thicker ring under `prefers-contrast: more`.
- Focus moves to the labelled call region once on connect (guarded against reconnect yanks).
- Pointer gestures have keyboard/tap equivalents: pin via Enter/Space + double-tap + long-press; layout via More; swipe-reply duplicated in the tap actions menu; drag-self-view is convenience-only.
- Meaning never by color alone: speaking = ring + animated bars; hand = icon badge; mic state = icon; connection = bar count; E2EE = padlock + (on narrow screens) label.
- Tile `aria-label`s compose name + live state; decorative pills marked `aria-hidden` to avoid double-reads.
- Live regions: toasts (`role=status`), typing indicator (`aria-live=polite`), CallAnnouncer context.
- Icon-only controls carry labels throughout (spot-checked ControlBar, tiles, panels, rows).

**Mobile UX**
- Safe-area insets respected on every floating surface; `viewport-fit=cover` set.
- 16px inputs prevent iOS focus-zoom (landing, prejoin, chat composer).
- Chat re-pins to latest on `visualViewport` resize only while composer focused — keyboard never buries history, scrolling up is never yanked.
- Thumb-zone control bar with 4s auto-hide, tap-to-recall, hold-open while menus/carousel are up; hidden bar is fully non-interactive (`pointer-events-none`).
- Full-screen ring overlay follows phone convention visually (big Accept/Decline) — see High finding for its lifecycle gap.
- One-time gesture coachmark teaches the three invisible gestures, persisted, tap-to-dismiss.

**Security-UX honesty**
- E2EE badge reflects *actual* `setE2EEEnabled` resolution; failure warns loudly + reports; key-mismatch surfaces a actionable re-share toast (throttled).
- Remote chat images are click-to-load with host disclosure (tracking-pixel defense retained).
- "Messages visible only to people in this call" stated in-panel; prejoin discloses camera/mic purpose + no-recording trust line; email-invite discloses third-party processing.

**Design-token discipline**
- No hardcoded colors/radii/shadows/durations observed in any reviewed island; motion uses `--dur-*`/`--ease-*`; on-video chrome consistently `bg-overlay` + white.
- Theme system is pure token swap (presets + vision-assistive + high-contrast + custom tab); zero component edits required — verified by reading the switcher and themes contract.
- Contrast tuning documented inline with measured ratios (ink-subtle, accent, danger fills).

**Performance-UX**
- Route/code-splitting keeps landing free of LiveKit; side-panel chunk warmed on connect so first open is instant; paged grid caps mounted `<video>` elements; memoized message list isolates composer/speaking churn.

## Effort estimate (rough)
~**6–8 hours** total. High ≈1–1.5h (ring expiry + missed-call surface). Mediums
≈3–4h (menu consistency 0.5h, fixed header 0.25h, slug sanitizer 0.5h +
server alignment, LayoutChip decision 0.25h–2h, touch targets 1h). Lows ≈2h,
each ≤30min except the dark-mode contrast computation (~1h including an axe
verification pass).