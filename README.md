# Manim

A free, lightweight video-calling app built on [LiveKit](https://livekit.io). Start a
call, share the link, talk — no account needed to join. Chat, screen share, reactions,
background blur, noise suppression, waiting rooms, and optional end-to-end encryption.

Runs entirely on free managed tiers: a React SPA on Cloudflare Workers, LiveKit Cloud
for media, Supabase for accounts and contacts.

> 🛑 **LiveKit testing is currently frozen** (quota near limit). Before running any
> test or dev command, read the banner in **[CLAUDE.md](CLAUDE.md)** — most gates
> connect to real LiveKit and burn participant-minutes.

## Stack

| Layer | What |
|---|---|
| UI | React 19, React Router 7, Vite 6, TypeScript, Tailwind 4 (oklch tokens) |
| State | Zustand — many small single-purpose stores (`src/store/`) |
| Media | `livekit-client` + `@livekit/components-react`; Krisp noise filter, MediaPipe blur |
| Backend | Cloudflare Workers (`worker/`), shared orchestration core (`server/core.mjs`) |
| Data | Supabase (Postgres + RLS) for accounts, contacts, presence |

The Worker and the local Express dev server (`server/token.mjs`) both wrap the *same*
`server/core.mjs`, so token minting, waiting-room/admit, host election, handoff and
moderation behave identically in dev and prod.

## How it fits together

The client asks the orchestration API for a scoped LiveKit JWT, then connects
**directly** to LiveKit Cloud — the Worker never touches media, only orchestration.
Privileged actions are authorized by verifying the caller's own signed LiveKit token
server-side, never a client-asserted role. E2EE keys live only in the URL hash and are
never sent to the server; chat is ephemeral with no storage at rest.

```
src/routes/     Landing · Legal · RoomRoute (the call page)
src/islands/    ~35 composed UI surfaces (CallRoom, Stage, ControlBar, ChatPanel, …)
src/features/   hook modules by domain (calls, chat, effects, reactions, pip, a11y)
src/store/      Zustand stores        src/lib/  LiveKit, API client, room links
worker/         Cloudflare Worker entry (routes /api/*, security headers)
server/         core.mjs (shared logic) · token.mjs (dev server) · webpush.mjs
tests/          Playwright specs + helpers.ts       audit/  responsive audit script
```

## Getting started

```bash
npm install
npm run dev          # web + token server. Without LiveKit creds the landing and
                     # prejoin work; the in-call UI is absent by design.
npm run typecheck    # tsc -b --noEmit — the compile gate
npm run test:unit    # Vitest, pure logic, no LiveKit
```

Full local QA needs LiveKit test credentials passed via **shell env** (don't edit
`.env`) — but see the freeze banner first. Setup lives in [TESTING.md](TESTING.md).

## Docs

- **[CLAUDE.md](CLAUDE.md)** — working agreements, constraints, the freeze banner. Start here.
- **[QA-PLAYBOOK.md](QA-PLAYBOOK.md)** — the full QA process: commands, parameters, pass criteria.
- **[TESTING.md](TESTING.md)** — test environment setup (test LiveKit project + secrets).
- **[Architecture-Plan.md](Architecture-Plan.md)** — the design doc and its rationale.
- **[STYLE.md](STYLE.md)** — the token/component contract. No hardcoded colors, ever.
- **[DEPLOY.md](DEPLOY.md)** — Cloudflare deployment, secrets, rollback.

## Constraints worth knowing before you change anything

- **Never `vite build` or deploy locally.** The build intentionally aborts on an empty
  `VITE_LIVEKIT_URL`; production builds on Cloudflare from `main`.
- **Mobile is pure touch** — no Esc, no hover, no keyboard shortcuts.
- **No page scroll** on landing, prejoin, or in-call. Chat and menus scroll internally.
- **All styling goes through oklch design tokens.** If it can't be built from the token
  system and shared primitives, it doesn't ship.

## License

See [LICENSE](LICENSE).
