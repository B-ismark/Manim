# Security & Privacy Findings — Manim

Overall the server-side authority model is strong: every privileged HTTP action verifies a signed LiveKit token, host authority lives in server-written room metadata (not forgeable participant metadata), SQL RLS is correctly scoped, and no sensitive secret reaches the client bundle. Findings cluster in the Realtime presence/ring layer and missing defense-in-depth headers.

## [HIGH] Unauthenticated personal Realtime channels — ring-spam & online-harvest
**File:** `src/features/calls/calls.ts:29-33`, `src/features/calls/usePresence.ts:12,29,57`
**Issue:** Ringing broadcasts to `supabase.channel("user:<targetId>").send({event:'ring'})` with no server check that the caller may ring the target. Any signed-in user who knows a target UUID can spam call-invites (attacker-chosen room + fromName → phishing-room lure) and can *subscribe* to `presence:<id>`/`user:<id>` to observe when an arbitrary user is online / which rooms they're in. UUIDs are cheaply obtained via `lookup_profile_id` (below).
**Evidence:** `const channel = supabase.channel(\`user:${data}\`); await channel.subscribe(); await channel.send({type:'broadcast',event:'ring',payload:{room,fromName}})`.
**Suggested fix:** Enable Supabase Realtime Authorization (RLS on `realtime.messages`) so only the channel owner can subscribe to their own `user:`/`presence:` channel, and gate `ring` so the sender must be an **accepted contact** — ideally move the broadcast into an Edge Function/RPC that checks the `contacts` table rather than letting the client publish directly. (Ties into the new contacts feature: contacts-only calling.)
**Severity:** HIGH (not Critical) — needs a signed-in account; payload is an invite/privacy-leak, not data exfiltration or takeover. But trivially abusable peer-to-peer.

## [MEDIUM] `lookup_profile_id` is an unthrottled email→account/UUID oracle
**File:** `DEPLOY.md` (`lookup_profile_id`), `src/features/calls/calls.ts:23`, `src/store/useContactsStore.ts:84`
**Issue:** Any authenticated user can confirm whether any email has an account and obtain its UUID, unthrottled. The design correctly avoids bulk dumping (profiles SELECT is own-row only; RPC returns one id) — the residual risk is per-email enumeration + the UUID that unlocks the HIGH channel abuse.
**Suggested fix:** Rate-limit the RPC per user; pair with the channel-authorization fix so a leaked UUID is no longer actionable. Acceptable as-is once channels are locked down.

## [MEDIUM] No Content-Security-Policy / `frame-ancestors`
**File:** `index.html` (no CSP meta), `worker/index.js:75-79` (sets only COOP/COEP), `public/` (no `_headers`)
**Issue:** No CSP and no `frame-ancestors`/`X-Frame-Options`. The app renders user-controlled image URLs and SVG via `dangerouslySetInnerHTML` (QR), so CSP is the key missing defense-in-depth; absence of `frame-ancestors 'none'` leaves clickjacking unmitigated.
**Suggested fix:** Add CSP in the Worker headers (beside COOP/COEP): `default-src 'self'`, allow LiveKit wss + Supabase + Giphy/Tenor img + MediaPipe CDN script/wasm, `frame-ancestors 'none'`.
**Severity:** MEDIUM — defense-in-depth (no known live injection sink), but raises blast radius if any XSS is ever introduced.

## [MEDIUM] Chat auto-loads arbitrary remote image URLs — IP/tracking leak
**File:** `src/features/chat/limits.ts:25-32`, `src/islands/ChatPanel.tsx` (ImageBubble)
**Issue:** Any message that is a bare `https://….png|gif|…` auto-renders as `<img src>`. A sender can post an attacker-controlled "image" endpoint; every recipient's browser auto-fetches it, leaking IP, geo, UA, online-timing — a tracking-pixel/IP-grabber. Host isn't constrained; `?…` allows per-recipient tokens. (Not XSS — `looksLikeImageUrl` requires `^https?://`, blocking `javascript:`/`data:`.)
**Suggested fix:** Render remote image URLs as click-to-load links, or proxy through the Worker to strip client IP, or allowlist hosts (giphy/tenor). Keep auto-inline for local object-URL file transfers.

## [LOW] Typing indicator trusts client-supplied identity (cosmetic spoof)
**File:** `src/features/chat/useChatMessages.ts:501-521`
**Issue:** The typing handler keys off `d.identity` from the JSON payload, not the unforgeable `msg.from.identity` (edits/reactions correctly use the latter). A participant can make the UI show someone else as "typing". Self-expires in 4s, no state corruption.
**Suggested fix:** Key off `msg.from?.identity`; ignore payload `identity` (mirror the edit/reaction handlers).

## [LOW] Display-name / guest impersonation (label only)
**File:** `server/core.mjs` (identity = `name#deviceId`), `useChatMessages.ts:97`
**Issue:** Guest display names aren't unique or authoritative; two guests can both be "Alice". Inherent to the no-account model. Security-relevant paths (host authority, end/merge/handoff) key off the full signed identity / server hostId / token userId — unspoofable — so this is social impersonation only.
**Suggested fix:** Optionally disambiguate duplicate names in the roster (short identity hash). No server change required.

## [LOW] Co-host can transiently remove/mute the primary host
**File:** `server/core.mjs:249-273`
**Issue:** `handleModerate` checks host/co-host but doesn't stop a co-host from removing/muting the primary host (recoverable — host can rejoin and reclaim hostId). Co-host roster changes are correctly primary-host-only, so authority can't be demoted, only disrupted.
**Suggested fix:** Reject `remove`/`mute` where `target === hostId` unless caller is the primary host. Low urgency (requires a voluntary co-host trust grant).

---
## Verified-safe / false positives (ruled out)
- **renderMarkdown/renderRichText**: React nodes only, no `dangerouslySetInnerHTML`, no XSS surface.
- **QR `dangerouslySetInnerHTML`**: SVG generated by `qrcode` lib from `window.location.href`, fixed structure — not an injection vector.
- **Contacts `.or(...)` interpolation**: `otherId` always a DB-sourced UUID; even if forged, the delete is RLS-bounded to the caller's own rows. (UUID-validation before interpolation would be defensive nice-to-have.)
- **Supabase RLS (profiles/contacts)**: correct — own-row only, can't spoof requester or accept on another's behalf; `list_contacts` SECURITY DEFINER only returns the caller's rows.
- **Host authority**: every privileged endpoint verifies the bearer LiveKit JWT, binds it to the room, checks `sub` against server-written hostId/coHosts. Strong.
- **Secrets**: only public `VITE_SUPABASE_URL/ANON_KEY`, `VITE_GIPHY_KEY`, `VITE_LIVEKIT_URL` reach the client. `LIVEKIT_API_SECRET`/`RESEND_API_KEY` are server-runtime only.
- **Auth redirect**: `window.location.origin` is constrained by Supabase's server-side redirect allow-list — not an open redirect.
- **"No storage at rest"**: verified — chat/files/history/pins/reactions ride LiveKit data channels + P2P byte streams; no DB/Worker write path.
- **Email invite endpoint**: validates recipient + link scheme, HTML-escapes, per-IP rate-limited.
- **E2EE passphrase**: entered at prejoin, client-state only, never in URL/hash.
- **npm audit (--omit=dev)**: 0 vulnerabilities across 125 prod deps.
