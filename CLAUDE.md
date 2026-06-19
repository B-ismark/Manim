# Manim — agent guide

LiveKit video-call app. React + Vite + Tailwind (oklch design tokens), Cloudflare
Workers backend (`worker/`, shared core in `server/`).

## Testing / QA
**Before testing or auditing the app, read [QA-PLAYBOOK.md](QA-PLAYBOOK.md)** — it has
the full process, commands, parameters, pass criteria, and the hard-won conventions.
Setup (test LiveKit project + secrets) is in [TESTING.md](TESTING.md).

Quick reference:
- Full local QA needs LiveKit test creds via **shell env** (don't edit `.env`):
  `LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… LIVEKIT_URL=… VITE_LIVEKIT_URL=… npm run dev`
- Gates: `npm run typecheck` · `npm test` (desktop) · `npm run test:mobile` ·
  `npm run test:mobile-sm` · `npm run test:a11y` · `npm run test:visual` ·
  `npm run lighthouse` · `npm run loadtest` (scale).

## Must-know constraints
- **Never `vite build` / deploy locally.** It aborts on empty `VITE_LIVEKIT_URL` by
  design; prod builds on Cloudflare from `main`. `tsc -b --noEmit` is the compile gate.
- **Verify deploys against the served artifact**, not a green build.
- **Mobile = pure touch**: no Esc / hover / keyboard shortcuts. Sheets close via the
  "Close panel" X; the control bar auto-hides (tap to reveal); More is a modal sheet.
- **No page scroll** on primary surfaces (landing, prejoin, in-call) — exceptions:
  the chat message list and menus scrolling *internally*. Check the short phone (`mobile-sm`).
- **Design decisions → check Mobbin** (Meet/Teams/Zoom/WhatsApp) before guessing.
- A11y is gated (axe, light + dark); contrast tokens are oklch — compute real WCAG
  ratios when changing them (see QA-PLAYBOOK §3).

## Branch hygiene — don't strand work
Work landing on a feature branch but never reaching `main` is a recurring failure.
- **Finish = merged.** When a task is done and gates pass, merge to `main` (fast-forward
  or PR) and push. Don't leave the only copy on a feature branch.
- Check before ending: `npm run unmerged` (lists commits on HEAD not yet on `origin/main`).
- A `Stop` hook (`.claude/settings.json`) warns automatically when unmerged commits exist.
