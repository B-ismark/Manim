# UI / UX / Accessibility / Code-Quality Findings — Manim

Design-token check: every `bg-*`/`text-*`/`border-*` color class in the touched files (Contacts, ChatPanel, formatText, Dialog, Settings, Landing, ParticipantsPanel) maps to a **real** token in `app.css`/`themes.ts` — `accent`, `accent-hover`, `accent-ink`, `accent-soft`, `success`, `danger`, `line`, `line-strong`, `sunken`, `surface`, `raised`, `ink*`, `warning*`. No invented classes. The new typing-dot (`bg-ink-subtle` + `mn-typing-dot`) is valid.

## [HIGH] Contacts load-failure error is set in the store but never rendered
**File:** `src/islands/Contacts.tsx:22-31` (consumer) / `src/store/useContactsStore.ts:62-64` (producer)
**Issue:** `refresh()` sets `error: 'Could not load contacts.'` on RPC failure, but `ContactsDialog` subscribes only to `rows` + `loading`. A failed load shows the empty state ("No contacts yet" + add hint) — indistinguishable from a genuine zero-contacts success, with no retry path short of reopening.
**Evidence:** No `useContactsStore((s)=>s.error)` selector anywhere; the empty branch keys solely off `accepted.length===0`/`loading`.
**Suggested fix:** Subscribe to `error` and render it (e.g. a `text-danger` line + Retry) distinct from the empty state.

## [MEDIUM] Mention autocomplete missing combobox SR wiring
**File:** `src/islands/ChatPanel.tsx:318-347` (listbox) + textarea
**Issue:** Visually + for sighted keyboard/touch users it's solid (Up/Down/Enter/Tab/Esc, `role=listbox`/`option`, `aria-selected`, focus stays in textarea). But the standard combobox links are missing: textarea has no `role="combobox"`/`aria-expanded`/`aria-controls`, and no `aria-activedescendant` → a screen-reader user gets no announcement that a list opened or which option is active.
**Suggested fix:** Give options stable `id`s; set `aria-activedescendant` to the highlighted option on the textarea while open; add `role=combobox`+`aria-expanded`+`aria-controls`.

## [MEDIUM] `mn-typing` not covered by the reduced-motion override
**File:** `src/styles/app.css` (reduced-motion `@media` block)
**Issue:** The block forces `animation-iteration-count:1` on `*` then re-asserts `animation:none` only for `.mn-float`/`.mn-ring`/`.mn-core`. `.mn-typing-dot` relies on the iteration clamp, so under reduced-motion each dot still plays one 1.2s cycle — the code comment claiming "static row" is only half true.
**Suggested fix:** Add `.mn-typing-dot { animation: none !important; opacity: 1 !important; }` to the reduced-motion block (match the `.mn-float` pattern).

## [LOW] Soft-accent text contrast in dark mode (spot-check needed)
**File:** `src/lib/formatText.tsx:33-36`, reused in ChatPanel ReactionChips/FileMessage/mention-picker + `Landing.tsx` OtherDeviceMeetings
**Issue:** Self-mention `bg-accent text-accent-ink` is tuned to AA. But `bg-accent-soft text-accent` in **dark mode** = `accent` text (L≈0.55) on `color-mix(accent 16%, surface L≈0.23)` ≈ L 0.28 → ~1.8–2.2:1, possibly below AA for the colored text. Bordered/contextual usage softens it, but it's reused in 5 sites.
**Suggested fix:** Compute the real ratio in dark mode (axe gate runs light+dark — confirm it passes here); if it fails, introduce an `accent-ink-soft` token or bump the mix. One token decision fixes all 5 sites.

## [LOW] Call / Add-to-call dead-tap for an email-less contact
**File:** `src/routes/Landing.tsx:44-50`, `src/islands/ParticipantsPanel.tsx:215-222`
**Issue:** Both correctly guard `if (!c.email) return` (the "missing guard" suspicion is a false positive), but the failure is silent — a contact with null email still shows a Call/Add button that does nothing on tap.
**Suggested fix:** Disable the action when `!contact.email`, or toast "No email on file."

## [LOW] Mention dropdown has no `max-h`/scroll
**File:** `src/islands/ChatPanel.tsx:318-347`
**Issue:** Opens upward (`bottom-full`, correct vs keyboard) with ≤6 suggestions, but no height bound — on a very short landscape phone with keyboard up, 6 rows could overflow the top of the chat panel.
**Suggested fix:** Add `max-h` + `overflow-y-auto` on the `<ul>` as a cheap safety bound.

## [LOW] `formatText.tsx` duplicates the mention OPEN delimiter as an inline magic literal
**File:** `src/lib/formatText.tsx:20`
**Issue:** `if (!text.includes(''))` uses the raw invisible PUA char copied from `mentions.ts`'s private `OPEN` — correct, but fragile/unreviewable in diffs.
**Suggested fix:** Export `OPEN` from `mentions.ts` and reuse it.

---
## Verified-safe / false positives (ruled out)
- **No invented design tokens** — all suspected ones (`bg-accent-soft`, `text-accent-ink`, `bg-success`, `border-line-strong`) are real.
- **Accept/Decline/Cancel/Remove/Call labels**: all carry `aria-label` (via `IconButton`) or visible text.
- **Focus rings**: `focus-visible:ring-2 ring-accent` on all touched inputs + global `:focus-visible` outline; the Dialog `px-1 -mx-1` change is the intentional fix that *gives* the ring clearance (no clipping side effect — `-mx` cancels `px`).
- **Touch usability**: Contacts dialog has no hover-only actions (all row buttons always visible); "Add from contacts" + tabs tap-reachable.
- **Empty/loading/error-of-add states**: Contacts + Requests have `Empty`; loading shows "Loading…"; `AddByEmail` surfaces success/error via `text-success`/`text-danger`; mention picker simply doesn't open with 0 participants. (Only the *load* error is unsurfaced — the HIGH above.)
- **Code quality**: no `any` casts in touched files; no unused imports; helpers consistent.
