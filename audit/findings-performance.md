# Performance Findings — Manim

No Critical/High. The architecture is performance-conscious: route/feature code-splitting, dynamic MediaPipe/emoji/Krisp imports, hard-capped tile paging, throttled segmentation, hysteresis-guarded quality reconcile, clean teardown of every timer/channel/handler.

## [MEDIUM] `motion` is a dead dependency (~100KB+, never imported)
**File:** `package.json` (`motion@^12.4.7` → pulls `framer-motion`)
**Issue:** Declared but never imported in `src/` (all animation is pure CSS). `grep "from 'motion'|framer"` → 0 import hits.
**Suggested fix:** Remove `motion` from dependencies. If tree-shaking already drops it the win is hygiene (downgrade to LOW); confirm it isn't in any built chunk, then delete.

## [MEDIUM] `ChatPanel` re-render hotspot — `useParticipants()` + unmemoized rows re-run `renderRichText`
**File:** `src/islands/ChatPanel.tsx:90` (`useParticipants()`), `:267-280` (rows), `:568`/`formatText.tsx:19` (`renderRichText`)
**Issue:** `useParticipants()` re-renders the whole panel on any roster change *including `isSpeaking` toggles* (several/sec while people talk). The panel only needs participants for the `@`-mention candidate list, but each churn re-renders all `MessageRow`s — none memoized — re-running `renderRichText` + `mentionsIdentity(matchAll)` for every visible message (up to the 200-message cap).
**Suggested fix:** Memoize `MessageRow` (`React.memo` + stabilize the `onReact`/`onReply`/`onTogglePin` callbacks via `useCallback` or id-based handlers), and/or derive the mention roster from a selector that ignores speaking state. Bounded by the 200-cap, so MEDIUM not HIGH.

## [MEDIUM] Contacts mutations refetch the whole list after every write
**File:** `src/store/useContactsStore.ts:101,114,128`
**Issue:** `addByEmail`/`accept`/`remove` each `await refresh()` (full `list_contacts()` RPC) → 2 round trips per mutation, re-fetching all rows for a single-row change.
**Suggested fix:** Optimistically mutate the local `rows` array (the change is a known insert/flip/delete) and skip the refetch (or refetch only on error). Low-frequency by design, so optional.

## [LOW] `@livekit/track-processors` is in BOTH the static `manualChunks.livekit` and a dynamic import
**File:** `vite.config.ts:39` + `src/features/effects/useBackgroundBlur.ts` (`await import('@livekit/track-processors')`)
**Issue:** The blur hook lazy-imports the processor (~160KB incl. MediaPipe), but `manualChunks.livekit` also names it — which can force MediaPipe into the eagerly-loaded room vendor chunk, defeating the lazy boundary the comment claims.
**Suggested fix:** Drop `@livekit/track-processors` from `manualChunks.livekit`; let Rollup emit it as its own dynamic chunk. Verify via `vite build` chunk output.

---
## Verified-safe / ruled out
- **Route/feature splitting**: `RoomRoute` (whole LiveKit tree) `lazy()`-loaded; SidePanel lazy; emoji dataset, Krisp, track-processors, e2ee-worker all dynamic/own-chunk. Landing ships almost no LiveKit. Sound.
- **Tile paging**: `MAX_PER_PAGE` hard-caps mounted `<video>`/DOM per page (20 desktop/9 touch) independent of measured height; only current page mounts; stable keys. Exactly right.
- **`useAdaptiveQuality` 6s reconcile**: one cheap interval; `restartTrack` guarded by hysteresis + in-flight guard + idempotent timer arming + early-return on no-op. Sound self-heal.
- **Blur `maxFps`**: a perf *improvement* (throttles segmentation; published track keeps full res/fps); rebuild keyed correctly.
- **Timers/intervals/listeners/channels/handlers**: swept — all have cleanup (chat timers, typing TTL, reaction timers, object-URL revoke, byte-stream handler pair, Supabase `removeChannel`, ResizeObserver disconnect, GIF debounce). No leaks.
- **`ringUser` channel-per-call**: deliberate fire-and-forget, properly removed; rings are rare. Fine.
- **Assets**: `public/` is a 247-byte SVG favicon + robots.txt; no raster assets; remote images `loading="lazy"`. Nothing to optimize.
- **Keys/effect deps**: stable tile/row keys; documented intentional eslint-disable on E2EE-once + blur radius-excluded deps. No thrash.
