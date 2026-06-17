# Visual Findings — Manim

Scope: no-creds responsive/overlap sweep (`audit/responsive-audit.mjs`) over **landing** + **prejoin** across 10 viewports (320→1920) + a resize sweep. In-call surfaces require LiveKit creds; the new in-call UI (chat @mentions, self-mention row highlight, typing-dot bubble, reply chip, background blur) was screenshotted live across two real participants earlier this session and reviewed — all correct (mentions match the requested design, reply preview clean, blur softens the background, typing bubble visible).

## Sweep result
- **Landing**: clean at all 10 viewports — 0 overflow, 0 overlap.
- **Prejoin**: 0 overflow at all viewports; the detector reports **1 overlap at every viewport** (identical 320→1920).
- **Resize sweep**: no overflow widths.
- **Errors**: none.

## [LOW] Prejoin "1 overlap" — likely a stable detector false positive
**File:** `src/islands/PreJoin.tsx` (`MicSpeakerTest` row) — not modified this session
**Issue:** The overlap count is identical at every viewport and the screen is **visually clean** (verified against `audit/shots/prejoin-iphone-390.png` — Back / preview / mic+cam toggles / mic-level meter + Test-speaker / name field / low-bandwidth / E2EE / Join all laid out correctly, nothing clipped or stacked). The most likely source is the mic-level meter's filled `<div>` measuring as overlapping its track `<div>` (both in the same flex row), which `responsive-audit.mjs`'s geometric heuristic flags but the in-call `overlaps()` helper (which uses `element.checkVisibility()`, per QA-PLAYBOOK §3) would not.
**Evidence:** Consistent across all sizes; no visual collision in the screenshot; PreJoin untouched this session.
**Suggested fix:** Confirm by inspecting the flagged pair in `audit/responsive-audit.json`; if it's the meter bar/track, treat as a known FP (or exclude nested same-parent decorative bars from the detector). Not a user-facing defect.

---
## Not covered (note)
- In-call pages at multiple viewports/themes via the prod build were **not** re-run here (per project rule: never `vite build`/deploy locally; the dev server was used for the responsive sweep). In-call correctness this session relied on live two-party Playwright screenshots against the running dev app.
- The **Contacts dialog** itself wasn't screenshotted — it requires an interactive signed-in session (Google/magic-link), which can't run headless. It reuses the proven `Dialog`/`Tabs`/`Avatar`/`Button` primitives and typechecks; render risk is low but visually unverified.
