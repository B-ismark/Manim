# Mobile UX improvements — progress & continuation

Work from the Mobbin-based UX audit (vs Teams / Meet / WhatsApp / Telegram / FaceTime / Skype).
Originally branch `feat/mobile-ux-improvements`; **now merged onto `main`** alongside the
parallel main-track work (simultaneous multi-device, portrait tiles, chrome auto-hide).

**Reconciliation note:** the touch signal is unified on `pointer: coarse` (`useIsTouch()` /
`isTouch()`), NOT viewport width — the old `useIsNarrow` was dropped because wide foldables beat
the width cutoff. The More menu is a bottom **sheet** on touch / popover on desktop; Participants
lives only in More on every device; open menus pin the auto-hiding control bar.
Typecheck + build green at each checkpoint.

## ✅ Done

### Session 1 (P0 + 2 P1)
- **Control bar flattened** — `src/islands/ControlBar.tsx`. More menu is a bottom **sheet** on mobile,
  popover on desktop (`useIsNarrow`). Sheet = reaction strip + 4-col `GridTile` quick toggles + rich
  sections (effects/audio/devices). Breakpoint-gated so nothing duplicates the inline desktop bar.
- **Pin works on touch** — `Stage.tsx` pin button now `[@media(hover:none)]:opacity-100`. Added
  one-time `PinCoachmark.tsx` (localStorage `mn.coach.pin`).
- **PreJoin reworked** — `PreJoin.tsx`. Mic/cam toggles moved below the video (keyboard no longer
  covers them). Permission **priming**: Permissions API probe → rationale card + "Allow camera &
  microphone" that pre-warms both before connect.
- **Banner safe-area** — `ConnectionBanner.tsx`, `HandoffBanner.tsx` now `top-[max(1rem,env(safe-area-inset-top))]`.
- **Virtual backgrounds** — `features/effects/useBackgroundBlur.ts` now does none/blur/**image** via
  `VirtualBackground`. Presets are runtime gradient data-URLs + custom upload. `BackgroundEffects.tsx`
  is now a thumbnail picker.
- **E2EE + connection chip** — `CallStatusBar.tsx` (top-center pill: "Encrypted" + weak-connection),
  wired in `RoomView.tsx`.

### Session 2 (this session)
- **Shared `useIsNarrow`** — `src/lib/useIsNarrow.ts`; ControlBar refactored to use it.
- **Chat polish** — `ChatPanel.tsx`: ephemeral-chat disclaimer line at top of panel; GIF picker is a
  bottom **sheet** on mobile (was a popover that drifted off-screen), popover on desktop. `GifPicker`
  root width → `w-full` so it fills the sheet.

## ✅ Session 3 — remaining backlog now built (on `main`)

All five items below shipped:
1. **Full-screen incoming call (1:1) on mobile** — `IncomingCallBanner.tsx` renders a full-screen
   ringing overlay (big Accept/Decline) on `useIsTouch()`, banner on desktop.
2. **Pending-invite roster** — `store/useInviteStore.ts` (device-local); `ParticipantsPanel` adds
   "Invited · waiting" ghost rows on email/ring/mailto, auto-dropped after 3 min or on join.
3. **Host mute-all + stop-all-video** — `ParticipantsPanel` footer loops `/api/moderate`. (The
   attendee-unmute permission lock is still deferred — needs a server endpoint.)
4. **Promote to co-host** — `server/core.mjs` (`ensureHost` + `handleRoomflags` coHosts patch,
   primary-host-only), `useSessionControl` (isPrimaryHost / setCoHost / toast), `ParticipantsPanel`
   per-row Make/Remove co-host + badge.
5. **Cleanup** — touch layout chip (`LayoutChip.tsx`, hides with chrome), self-view ring, PinCoachmark
   mentions swipe, trimmed copy (BackgroundEffects / NoiseSuppression / ChatPanel / PreJoin).

## ⏳ Original backlog spec (now built — kept for reference)

### 1. Full-screen incoming call (1:1) on mobile
- File: `src/islands/IncomingCallBanner.tsx` (idle/not-in-call surface).
- On `useIsNarrow()`, render a full-screen overlay (avatar, "X is calling", big green Accept / red
  Decline) instead of the top banner. Keep banner on desktop. Leave `InCallIncomingBanner.tsx` as-is
  (in-call keeps the banner — that's where Merge/Switch live).

### 2. Pending-invite state in roster
- New store e.g. `src/store/useInviteStore.ts`: `pending: {id,label,ts}[]`, `addInvite(label)`,
  `clearInvite(id)`.
- In `ParticipantsPanel.tsx`: on successful `emailInvite` / `ring`, `addInvite(to/email)`. Render ghost
  rows under the roster labelled "Invited · waiting". Auto-drop entries older than ~3 min and any whose
  label matches a present participant name (case-insensitive). Client/device-local only.

### 3. Host: mute-all + stop-all-video
- Client-only — works with the existing `/api/moderate` (`moderate({room,token,target,action:'mute',trackSid})`).
- In `ParticipantsPanel.tsx` add a host-only footer: "Mute all" + "Stop all video" that loop over
  `participants` (excluding self) and call `moderate` for each unmuted mic / active camera track.
- NOTE: the "allow attendees to unmute / start video" *permission lock* was intentionally deferred — it
  needs a new server endpoint (LiveKit `updateParticipant` permission / canPublish). Mute-all is the
  high-value 80%. Flag if you add the lock so the toggle isn't fake.

### 4. Promote to co-host  (server + client — core is shared, one change covers dev + Worker)
- `server/core.mjs`:
  - `handleRoomflags`: accept a `coHosts` array patch (host-only via existing `ensureHost`).
  - `ensureHost`: return true if verified identity === `flags.hostId` **or** is in `flags.coHosts`.
    (Co-hosts then pass moderation auth; the server performs actions with its own admin creds, so
    co-hosts do NOT need `roomAdmin` in their join token.)
- `src/lib/orchestrator.ts`: add `coHosts?: string[]` to `RoomFlagsRequest`.
- `src/features/session/useSessionControl.ts`: read `coHosts` from room metadata; `isHost` =
  hostId match **or** in coHosts. Add a `setCoHosts`/promote helper. Add a toast effect "You're now a
  co-host" when local identity enters coHosts.
- `src/islands/ParticipantsPanel.tsx`: per-row host action "Make co-host" / "Remove co-host" (store
  `participant.identity`); `isHost` recompute to include coHosts.

### 5. Cleanup
- **Layout discoverability**: mobile already gets named Grid/Speaker/Spotlight tiles in the More sheet +
  swipe gesture. Add a small always-visible layout chip top-left of the stage on mobile (hides with
  chrome) that opens the named menu; extend `PinCoachmark` copy to mention "swipe to switch layout".
  Keep desktop `LayoutSwitcher` dropdown.
- **Tile / self-view polish**: `Stage.tsx` `SelfViewCard` — add subtle `ring-1 ring-white/10`, ensure it
  clears `CallStatusBar` (top) and control bar (bottom). Light tile-overlay tidy.
- **Less AI fluff**: trim verbose helper copy — `BackgroundEffects.tsx` (low-power + high-quality notes),
  `ControlBar.tsx` `NoiseSuppression` description, `ChatPanel` empty-state ("Say hello, share a file or a
  GIF." → shorter), PreJoin e2ee helper. Keep only genuinely useful one-liners.

## Notes
- Two reference apps not yet adopted but worth it later: persistent "You're sharing — Stop" banner;
  Meet-style combined remove+block+report dialog.
- Scheduling / recording / breakout / whiteboard / live-stream were explicitly deferred.
