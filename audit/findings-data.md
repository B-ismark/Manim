# Data & State Correctness Findings — Manim

State lives in zustand stores + LiveKit data-channel sync + Supabase tables (profiles, contacts). Findings concentrate in the **new contacts feature** (race conditions from a directed-edge model with only a same-direction unique constraint) and the account-name sync.

## [HIGH] Mutual simultaneous add → two reciprocal rows that never reconcile
**File:** `src/store/useContactsStore.ts:91-100`; `DEPLOY.md` (`unique (requester, addressee)`)
**Issue:** `unique(requester,addressee)` only blocks the *same-direction* duplicate. If A and B add each other before either request lands, the stale-`rows` check finds nothing on either side, so both insert: `(A→B,pending)` and `(B→A,pending)` — different directions, both legal. Result: a permanent reciprocal-pending state where each sees the other as both outgoing and incoming; accepting flips one row to accepted while the reverse stays pending, so `list_contacts` returns the same person twice (one accepted, one pending). The same person then appears in **both** the Contacts tab and Requests tab; accept/remove touch only one row.
**Evidence:** `accept` matches the single reverse row; only `remove` (the `.or(...)` both-directions delete) cleans up the pair. No DB guard prevents both `(A,B)` and `(B,A)`.
**Suggested fix:** Enforce a canonical single-row-per-pair invariant in the DB — unique index on `(least(requester,addressee), greatest(requester,addressee))`, or a `before insert` trigger that converts an insert into an accept when the reverse pending row exists. Client direction-checks can't close this race.

## [HIGH] `addByEmail` check-then-insert is non-atomic, decided from stale `rows`
**File:** `src/store/useContactsStore.ts:91-100`
**Issue:** Accept-vs-insert is decided from `get().rows`, refreshed only on dialog-open or after a prior mutation. Between open and submit the peer may have sent/accepted/declined, so: (1) peer sent you a request after your last refresh → `existing` undefined → you `insert` instead of `accept` → reciprocal-pending pair (above); (2) you already have an outgoing row but rows are stale → re-insert hits the unique constraint and surfaces a generic "Could not send the request." No transaction / `on conflict`.
**Suggested fix:** Make it a server-side atomic RPC (lock/lookup the pair, insert-pending-or-flip-reverse-to-accepted with `on conflict do nothing`). At minimum `refresh()` before deciding and distinguish unique-violation (23505) from other errors. (Same root as the finding above — fix together.)

## [HIGH] Stale local device name can clobber a fresher account name across devices
**File:** `src/store/useAuthStore.ts:96-104, 130-139`
**Issue:** `syncProfile` resolves `accountName || local || nameFromSession` and writes it back — but the account wins **only if its `display_name` is already non-empty**. Sign in on device B with a stale `manim-display-name` while the account row has an empty/absent name → `resolved = local` (stale) → upserted, clobbering the intended name. Pure last-writer-wins with no version/timestamp.
**Evidence:** `const resolved = accountName || local || nameFromSession(session)`; unconditional upsert; profiles has no `updated_at` to compare.
**Suggested fix:** Treat the account as authoritative when signed in — only seed from `local` when the account row is *absent*, not merely empty; or add `profiles.updated_at` and compare before overwriting.

## [MEDIUM] Contacts sort relies on `updated_at`, set with the client clock, no trigger
**File:** `src/store/useContactsStore.ts:112`; `DEPLOY.md` (`order by c.updated_at desc`)
**Issue:** `list_contacts()` orders by `updated_at desc`, but the column has no `before update` trigger — it advances only when the client sets it, and `accept` sets `new Date().toISOString()` (client clock) into a column otherwise filled by `now()` (server clock). A skewed client clock mis-sorts a freshly accepted contact; `remove`/name-changes don't bump it. List contents are correct; order can be wrong.
**Suggested fix:** Add a `before update` trigger setting `updated_at = now()` server-side; stop sending it from the client.

## [MEDIUM] Debounced name write races the sign-in upsert (unordered double-write)
**File:** `src/store/useAuthStore.ts:97 → useAppStore.ts:66 → useAuthStore.ts:130-139`
**Issue:** On sign-in, `syncProfile` both calls `setDisplayName` (→ 600ms debounced upsert via `persistNameToAccount`) and does its own immediate upsert. Two writes of the same row with no ordering guarantee; if the user edits within 600ms, which value lands is network-timing-dependent.
**Suggested fix:** During sign-in, set state without going through `persistNameToAccount`, or funnel all profile writes through one serialized queue.

## [MEDIUM] `encodeMentions` mis-tags when two participants share a display name
**File:** `src/features/chat/mentions.ts:36-46`
**Issue:** Encoding matches `@Name` by name only; with duplicate display names (common for guests) the first-sorted target's identity is encoded — wrong person tagged / "you were mentioned" fires for the wrong user. Longest-first only disambiguates prefixes, not exact duplicates. Related: the boundary lookahead requires only a *trailing* boundary, so `foo@Jane` mid-word would also encode; names containing `@` or trailing punctuation are edge cases.
**Suggested fix:** On duplicate names, disambiguate in the composer or refuse to auto-encode the ambiguous `@Name` (leave plain). Anchor the match on a leading boundary too.

## [MEDIUM] Mixed timestamp clocks within `contacts.updated_at` (client ISO vs server now())
**File:** contacts: `toISOString()` + `now()`; chat: numeric ms-epoch throughout
**Issue:** No epoch-vs-ISO comparison exists across the two state systems (chat is uniformly numeric; contacts uniformly ISO), so no live cross-format bug. The real hazard is the *client-vs-server clock* mix inside `contacts.updated_at` (see the ordering finding). Flagged so the fix lands in one place.
**Suggested fix:** Let the DB own `contacts.updated_at`.

---
## Verified-safe / false positives (ruled out)
- **Circular import** `useAppStore ↔ useAuthStore`: safe — both reference the other lazily (inside functions), not at module-eval; ES live bindings resolve before first use.
- **Mention/reply delimiters**: U+E000–E002 (mentions) and U+0002/U+0003 (reply) are non-typable; user text can't forge/break them. `escapeRegExp` prevents regex injection from names. `plainText` round-trips cleanly.
- **Edit/reaction/pin id-gating + history replay**: internally consistent; `authorRef` rebuilt synchronously in the items memo; edits author-gated; reactions drop unknown ids; history dedupes by id. Ephemeral by design.
- **Decline-then-readd**: works; `remove` deletes both directions; `on delete cascade` → no orphans. (Caveat: `accept`/`remove` ignore the Supabase error result → an RLS-rejected mutation looks like success; surface or log it.)
- **status pending→accepted**: enforced server-side (RLS `addressee` + CHECK); client `.match` scopes to `status:'pending'`. Sound.
- **null handling** at boundaries (`nameFromSession`, contacts mapper): robust fallbacks; worst case is a harmless no-op upsert of `{id}`.
