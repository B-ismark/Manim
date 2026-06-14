# STYLE.md — Manim UI Style Contract

> **Read this before building any new or large UI element. Update it whenever a
> rule changes or a new token / primitive is introduced.** This file is the law;
> [Architecture-Plan.md](Architecture-Plan.md) is the why.

The product goal: an island-styled, progressive, lightweight, accessible video
platform that looks identical in spirit on mobile and desktop. The hard
constraint that makes that maintainable: **zero orphaned UI**.

---

## 1. Token law

**Never hardcode a color, radius, shadow, font, duration, or easing in a
component.** Every visual value comes from a design token.

- Tokens live in [src/styles/app.css](src/styles/app.css) (`@theme` block) and
  are consumed as Tailwind utilities (`bg-surface`, `text-ink`, `rounded-island`,
  `shadow-island`) or `var(--token)`.
- Need a value the tokens don't have? **Add a token**, document it here, then use
  it. Do not inline `#hex`, `12px`, `rgba(...)`, `0 4px 8px ...`, `200ms`, etc.
- Motion values use `--dur-*` / `--ease-*`. Never inline `300ms` or a bezier.

Token families (see app.css for exact values):

| Family | Tokens |
|---|---|
| Surfaces | `stage`, `surface`, `raised`, `sunken` |
| Lines | `line`, `line-strong` |
| Ink (text) | `ink`, `ink-muted`, `ink-subtle` |
| Accent | `accent`, `accent-hover`, `accent-ink`, `accent-soft` (auto-derived) |
| Status | `danger`(+`-hover`,`-ink`), `success`, `warning`, `info` |
| Special | `scrim`, `overlay` (on-video chrome), `speaking` |
| Radius | `tile`, `island`, `control`, `field` |
| Shadow | `island`, `raised`, `pop` |
| Motion | `--dur-fast/base/slow`, `--ease-island/snap` |

---

## 2. Island model

The screen is a calm **neutral stage** (`bg-stage`). Functional surfaces float
above it as **islands**: self-contained, rounded, shadowed, with margin. Refs:
ClickUp (call layout), Runway (floating toolbars/panels).

Rules:
- Islands use `rounded-island`, `shadow-island` (or `shadow-raised` when
  elevated above another island), `bg-surface`.
- **Nothing is welded to the screen edge.** Islands keep margin from edges and
  from each other. No full-bleed bars.
- Round controls/pills use `rounded-control`; inputs/small controls use
  `rounded-field`; video cards use `rounded-tile`.
- Use the `<Island>` primitive — don't re-implement the panel shell.

---

## 3. Anti-orphan gate

An element ships only if it is built from existing **tokens + primitives**.

- If it needs a value no token provides → add the token (§1) first.
- If it needs behavior/structure no primitive provides → add a primitive to
  `src/components/primitives/`, document it in §7, then compose with it.
- **No one-off styles. No bespoke component that duplicates a primitive.**
- Features compose islands; islands compose primitives; primitives consume
  tokens. Tweaks happen at the lowest layer and propagate up.

---

## 4. Responsive law

**One component, breakpoint-driven layout. Never a separate mobile screen.**

- A surface renders differently per breakpoint via props/CSS, not via a forked
  component. Example: `ControlBar` is a centered floating pill on desktop and a
  thumb-zone bar on mobile — **same component**.
- Side panels **dock and reflow** the stage on desktop; become **full-height
  sheets** on mobile — same `SidePanel`/`Sheet` primitives.
- Mobile and desktop must read as the same product. Differences are layout, not
  identity.
- Breakpoints: design mobile-first; `md` (≥768px) is the desktop pivot.

---

## 5. Progressive disclosure

Default to the minimum. Reveal on demand.

- **Tier 0 (always visible):** own video, others' video, mic, camera, leave.
- **Tier 1 (one tap):** share screen, chat, participants, layout switch,
  reactions, raise hand.
- **Tier 2 (behind More / Settings):** device selection, background blur, theme,
  E2EE, diagnostics, host controls.

A first-time participant must be able to join and talk having seen only Tier 0.
Max two menu levels. One primary action per context. Plain-language labels.

---

## 6. Accessibility (a core building block, not a finishing pass)

Accessibility is one of the product's foundational building blocks — designed in
at the token/primitive layer, not bolted on later. Every new element is checked
against this section *before* it ships (it is part of the anti-orphan gate §3).

- **All interactive overlays use Radix primitives** (Dialog, Popover, Tooltip,
  DropdownMenu, Slider, Switch, Tabs). Never hand-roll focus traps, ARIA roles,
  or keyboard handling.
- Every interactive element is keyboard reachable and operable; visible focus
  ring is global (`:focus-visible` in app.css) — don't remove it.
- Manage focus on open/close of islands/sheets/dialogs (Radix handles this when
  used correctly).
- Icon-only controls require an accessible label (`aria-label` /
  `VisuallyHidden`). Pointer-only conveniences (e.g. drag-to-move self-view)
  must not be the *only* way to reach a function.
- Honor `prefers-reduced-motion` — handled globally in app.css; don't bypass it.
- **Vision-assistive themes** (Deuteranopia, Tritanopia) ship as first-class
  presets; never encode meaning in color alone (pair with icon/text).
- **Contrast:** body text on its surface ≥ 4.5:1. **Chrome placed over video**
  (name/quality/hand pills, tile buttons) uses the `overlay` token — a fixed
  dark wash that keeps white text legible over any video, in light *and* dark
  mode. Never put text directly on `scrim` over video — `scrim` is for
  modal backdrops only.

---

## 7. Primitive library

Location: `src/components/primitives/`. Build features from these; extend the
list here when you add one.

| Primitive | Purpose |
|---|---|
| `Button` | Text actions. Variants: `accent`, `neutral`, `ghost`, `danger`. |
| `IconButton` | Icon-only round control (control bar, toolbars). Requires `label`. |
| `Island` | The floating panel shell (radius + shadow + surface + padding). |
| `Sheet` | Mobile full-height / desktop docked side panel (Radix Dialog based). |
| `Dialog` | Modal (Radix Dialog) over `scrim`. |
| `Popover` | Anchored transient panel (Radix Popover). |
| `Tooltip` | Hover/focus hint (Radix Tooltip). |
| `Toggle` | On/off switch (Radix Switch). |
| `Slider` | Range input (Radix Slider) — e.g. blur radius. |
| `DropdownMenu` | Action menu (Radix DropdownMenu) — per-participant moderation, device pickers. Ships `DropdownItem`, `DropdownSeparator`, `DropdownLabel`. |
| `Tabs` | Segmented tab control (Radix Tabs) — combines Chat / People into one `SidePanel`. Ships `TabPanel`. |
| `Avatar` | Participant identity fallback (initials over tinted bg). |
| `Badge` | Small status/count chip. |

---

## 8. Motion

- Subtle and purposeful: islands ease in/out, layout shifts animate; nothing
  bounces or distracts from video.
- Use the `motion` library + `--dur-*` / `--ease-island`.
- All motion must degrade under `prefers-reduced-motion` (global rule in §6).

---

## 9. Theming (Slack model)

- **Mode** (Light / Dark / System) controls surface tokens.
- **Accent presets** are named tiles that swap only the accent family.
- **Custom tab** (progressive disclosure) exposes per-token overrides for power
  users.
- Vision-assistive presets always present.
- Implemented purely as token swaps in [src/store/useThemeStore.ts](src/store/useThemeStore.ts)
  + [src/styles/themes.ts](src/styles/themes.ts). A theme change touches **zero
  components** — if you find yourself editing a component to support a theme,
  you've broken §1.

---

## 10. File / naming conventions

- `src/components/primitives/` — reusable atoms (§7).
- `src/islands/` — composed floating surfaces (Stage, ControlBar, SidePanel,
  PreJoin, HostIsland, SettingsIsland, WaitingRoom, NotificationToasts).
- `src/features/` — domain logic + hooks (room, chat, participants, devices,
  merge, handoff).
- `src/routes/` — page-level composition (Landing, PreJoin, Room).
- Components: `PascalCase.tsx`. Hooks: `useThing.ts`. One primary export per file.
- Import alias `@/` = `src/`.
