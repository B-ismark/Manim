# Panel toggle → accidental leave: measurements

Research for the desktop-layout item "panel toggle causes accidental meeting exits".
**Prototype-first — nothing in `src/` is changed by this work.**

Interactive rig: [`docs/prototypes/panel-reflow-rig.html`](prototypes/panel-reflow-rig.html)
(open it in a browser; every number below is measured live off its DOM).

## What actually causes the exits

Not the grid. The **control bar re-centres**.

`ControlBar.tsx:516` and `RoomView.tsx:448` both carry
`panel && 'md:pr-[20rem] lg:pr-[22rem] xl:pr-[25rem]'`. On the bar that padding sits
inside a `fixed inset-x-0 flex justify-center` wrapper, so the bar's centre — and every
button on it — travels left by exactly half the padding.

| | bar travel | Chat centre → Leave control |
|---|---|---|
| md (768+) | 160px | 151–280px |
| lg (1024+) | 176px | 151–280px |
| xl (1280+) | 200px | 151–280px |

The travel lands inside that span at **all three** breakpoints, so a pointer left where
the Chat button was is now over Leave. The second click — to close the panel — leaves
the call. `leaveWithUndo` catches it with an 8s Rejoin toast, which is a net, not a fix.

## Options measured (host, widest Leave target)

| rule | 768 | 1024 | 1280 | 1440 | 1728 |
|---|---|---|---|---|---|
| 00 current | 160 ⚠ | 176 ⚠ | 200 ⚠ | 200 ⚠ | 200 ⚠ |
| 01 collision-only offset | 224 ⚠ | 128 | 48 | 0 | 0 |
| 02 Leave on the left | 160 | 176 | 200 | 200 | 200 |
| 03 settle guard | 160 held | 176 held | 200 held | 200 held | 200 held |
| 04 bar never moves | 0 buried | 0 buried | 0 buried | 0 | 0 |

⚠ = pointer lands on a Leave control. *buried* = bar doesn't move but the panel covers
its right end. Measured bar width (host, desktop): **560px**.

Proposed: **01 + 03**. At 1024 option 01 alone clears Leave by only 23px — one more
control on the bar closes that gap, which is what 03 insures against. 768–1023px needs
a separate decision (overlay panel below `lg`, or a compacted bar): a 560px bar and a
304px docked panel do not fit in 768px.

## Separate grid defect found while measuring

The ask was whether the grid could scale tiles instead of hard-shifting. **It already
does** — `fitMixedRows` is a justified packer that holds each tile's snapped aspect and
picks the row count maximising the smallest tile, and `useElementSize` re-measures
through the transition with a 2px threshold.

But `gridCapacity` re-paginates. Opening the panel with 16 in the call:

- **1024px** — 4 col / 16 tiles → 3 col / 12 tiles (four people jump to page 2)
- **768px** — 3 col / 12 tiles → 2 col / 8 tiles
- 1280px and up — unchanged

Fix is independent: derive page capacity from the *undocked* stage width, or hold it
across a panel toggle, so docking can only shrink tiles, never page them away.

## Not yet decided

1. 01 + 03, or 02 (which is immune at 768 but moves Leave off the right — Mobbin check).
2. What 768–1023px does: overlay panel, or compact the bar.
3. The settle-guard window (350ms is a guess).
