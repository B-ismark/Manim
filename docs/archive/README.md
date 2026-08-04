# Archived reports

Point-in-time snapshots, kept for context. **Nothing here is a live to-do list.** They
sat at the repo root long after their findings were closed, where they read as current
work. Treat them as history; if you want the state of the code, read the code.

| Doc | Date | What it was |
|---|---|---|
| [AUDIT.md](AUDIT.md) | 2026-06-17 | Full-app sweep: security, data, performance, UI/a11y, visual. Indexes the five `findings-*.md` below. |
| [findings-security.md](findings-security.md) | 2026-06-17 | Security & privacy dimension. |
| [findings-data.md](findings-data.md) | 2026-06-17 | Data & state correctness dimension. |
| [findings-performance.md](findings-performance.md) | 2026-06-17 | Performance dimension. |
| [findings-ui-code.md](findings-ui-code.md) | 2026-06-17 | UI / UX / accessibility / code dimension. |
| [findings-visual.md](findings-visual.md) | 2026-06-17 | Visual pass. |
| [E2E-FINDINGS.md](E2E-FINDINGS.md) | 2026-06-16 | The original end-to-end sweep + browser-capacity ceiling (~8 headless Chromium per machine — still the reason scale testing uses `lk load-test`). |
| [MOBILE-UX-PROGRESS.md](MOBILE-UX-PROGRESS.md) | — | Mobile touch-UX workstream log. All items shipped. |

## Status as of 2026-08-04

All 10 items on AUDIT.md's remediation-priority list were re-verified against the
current code and are **fixed** — including the four HIGHs (Realtime channel
authorization, the contacts add race, name-sync clobbering, silent contacts-load
failure). Two things did not close cleanly and are worth carrying forward:

- **Multi-device name edits are still last-writer-wins.** AUDIT item 3's main path is
  closed — an account row now wins over stale device-local storage on sign-in — but
  `src/store/useAuthStore.ts` still upserts `display_name` with no version column, so
  two devices editing the name *simultaneously* can still race. Low impact, not fixed.

- **The SQL behind items 1, 2 and 7 lives only as copy-paste blocks in DEPLOY.md.**
  There are no `.sql` migration files in the repo and nothing in CI applies them, so
  those fixes are correct-but-manual: the RLS policies on `realtime.messages`, the
  canonical-pair unique index, the `add_contact`/`ring` RPCs, and the
  `contacts_touch` trigger only exist in a given Supabase project if an operator ran
  them by hand. Worth verifying against the live database. The failure mode is
  fail-closed (calling breaks) rather than a silent regression to the vulnerable
  behavior, which is the safer direction, but it is unverified state.
