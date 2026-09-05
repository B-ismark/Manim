# Platform Audit — Manim — 2026-06-17

LiveKit video-call app (React 19 + Vite SPA, Cloudflare Workers, Supabase, LiveKit). Report only — no code changed. Scope weighted toward this session's new work (contacts, chat @mentions/typing/reply, account-name sync, blur/LOD) plus a full-app sweep of security, data, performance, UI/a11y, and a no-creds visual pass.

## Summary
- **Critical: 0**
- **High: 4**
- **Medium: 11**
- **Low: 9**

Headline: the **server-side trust model is strong** (signed-token authority on every privileged action, correctly-scoped RLS, no secrets in the bundle, 0 npm vulns, ephemeral chat as designed). The real risk sits in two places: the **unauthenticated Supabase Realtime presence/ring layer**, and **race/sync correctness in the just-shipped contacts feature**.

## Top 10 Issues (remediation priority)
1. **[HIGH] Unauthenticated `user:`/`presence:` Realtime channels** — any signed-in user can ring-spam or harvest who's online for any known UUID → see [findings-security.md](findings-security.md). Fix dovetails with making calling contacts-only.
2. **[HIGH] Contacts reciprocal-pending race / non-atomic add** — mutual simultaneous add creates two rows that never reconcile; same person shows in both Contacts and Requests → [findings-data.md](findings-data.md).
3. **[HIGH] Stale local name clobbers account name across devices** — silent loss of a user's chosen name; last-writer-wins with no versioning → [findings-data.md](findings-data.md).
4. **[HIGH] Contacts load failure is silent** — RPC error shows the empty state ("No contacts yet"), no signal/retry → [findings-ui-code.md](findings-ui-code.md).
5. **[MEDIUM] No CSP / `frame-ancestors`** — missing defense-in-depth for an app rendering remote media + SVG → [findings-security.md](findings-security.md).
6. **[MEDIUM] Chat auto-loads arbitrary remote image URLs** — tracking-pixel/IP leak among participants → [findings-security.md](findings-security.md).
7. **[MEDIUM] `contacts.updated_at` set on the client clock, no trigger** — list ordering can be wrong → [findings-data.md](findings-data.md).
8. **[MEDIUM] `ChatPanel` re-render hotspot** — `useParticipants()` + unmemoized rows re-run `renderRichText` on every speaking-state churn → [findings-performance.md](findings-performance.md).
9. **[MEDIUM] Reduced-motion doesn't fully stop the typing-dot animation** — easy a11y fix → [findings-ui-code.md](findings-ui-code.md).
10. **[MEDIUM] `motion` is a dead ~100KB dependency** — never imported; remove → [findings-performance.md](findings-performance.md).

## Findings by Dimension
- **Security & Privacy** → [findings-security.md](findings-security.md) — 1 High, 3 Medium, 3 Low
- **UI/UX & Flow (2026-08-22)** → [../../audit/findings-uiux-flow.md](../../audit/findings-uiux-flow.md) — 1 High, 5 Medium, 9 Low; prior UI fixes verified present
- **Data & State Correctness** → [findings-data.md](findings-data.md) — 2 High, 3 Medium, + ruled-out
- **Performance** → [findings-performance.md](findings-performance.md) — 3 Medium, 1 Low (+ much ruled out)
- **UI / UX / Accessibility / Code** → [findings-ui-code.md](findings-ui-code.md) — 1 High, 2 Medium, 4 Low
- **Visual** → [findings-visual.md](findings-visual.md) — 1 Low (likely false positive)

## Notable verified-safe (not findings)
Host authority (signed-token, server-written hostId); profiles/contacts RLS; no XSS in markdown/QR/mention render; secrets server-only; "no storage at rest" for chat; E2EE passphrase never in URL; auth redirect allow-listed; all timers/channels/handlers cleaned up; tile paging caps mounted video; blur `maxFps` + LOD reconcile are sound; 0 npm vulns.

## Deferred / context
- **In-call + Contacts visual coverage**: in-call surfaces were verified via live two-party screenshots this session; the Contacts dialog needs an interactive signed-in session and wasn't screenshotted (reuses proven primitives, typechecks). Per project rule we don't `vite build`/deploy locally, so the prod-build multi-viewport visual matrix wasn't re-run.
- **Several Low items** (display-name spoofing, co-host removing host, guest identity) are inherent to the no-account/ephemeral model and partly intentional.

## Effort estimate (rough)
~**20–25 hours** total. The 4 High items are ~7–10h (the Realtime-authorization + contacts-gated ring is the largest, ~3–5h; the contacts canonical-pair constraint + atomic add RPC ~2–3h; name-authority ~1h; surface load error ~0.5h). Mediums ~8–10h. Lows ~3–4h. Quick wins (<30 min each): reduced-motion typing dot, remove `motion`, surface contacts load error, `updated_at` trigger.
