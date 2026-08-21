# Panel toggle → accidental leave: measurements and what shipped

Desktop-layout item "panel toggle causes accidental meeting exits".

Interactive rig: [`docs/prototypes/panel-reflow-rig.html`](prototypes/panel-reflow-rig.html)
(open it in a browser; the matrix on that page is read off its own live DOM).

## What caused the exits

Not the video grid. **The control bar re-centred.**

`ControlBar.tsx` and `RoomView.tsx` both carried
`panel && 'md:pr-[20rem] lg:pr-[22rem] xl:pr-[25rem]'`. On the bar that padding sat
inside a `fixed inset-x-0 flex justify-center` wrapper, so the bar's centre — and every
button on it — travelled left by exactly half of it.

| | bar travel | Chat centre → Leave control |
|---|---|---|
| md (768+) | 160px | 151–284px |
| lg (1024+) | 176px | 151–284px |
| xl (1280+) | 200px | 151–284px |

The travel landed inside that span at **all three** breakpoints, so a pointer resting
where the Chat button had been was now over Leave. The second click — to close the
panel — left the call. `leaveWithUndo`'s 8s Rejoin toast absorbed it, which is why this
showed up as an annoyance rather than a bug report.

## What shipped

Two mechanisms, plus a change to where the panel sits.

**Collision-only offset** (`lib/panelDock.ts`). The bar keeps its viewport centre and
moves only by the overlap it actually has with the panel, measured from the bar's real
rendered width — not by half the panel's width. As a transform, not wrapper padding:
padding shrinks the box the bar is centred in, and the bar is a flex item, so a wide
enough bar would shrink, change the overlap, and change the padding again.

**The panel keeps out of the bar's band below `xl`** (`Sheet.tsx`). It stops at
`bottom-[5.75rem]`, which clears the bar's 1rem inset, its 62px island and the 12px
gutter. With nothing beside the bar there is no collision to size around, so the bar
does not move at all below 1280px. Below `lg` the panel also stops reflowing the stage
and floats over it — a 614px bar and a 19rem panel do not both fit in 768px.

**Settle guard** (`lib/useSettleGuard.ts`). For ~350ms after a reflow that moved the
bar, a destructive control refuses a pointer click unless the pointer has since
travelled 8px. Keyboard and assistive-tech activation are never guarded — they carry no
pointer position, so a reflow cannot mis-aim them — and rejecting disarms, so a second
press goes straight through.

Net bar travel, measured:

| | 768 | 1024 | 1280 | 1440 | 1728 |
|---|---|---|---|---|---|
| before | 160 ⚠ | 176 ⚠ | 200 ⚠ | 200 ⚠ | 200 ⚠ |
| after | 0 | 0 | 75 | 0 | 0 |

⚠ = the pointer lands on a Leave control.

## The measurement that was wrong first time

The prototype originally reported the bar at **560px**, because its mock was missing the
**Audio output** button. The running app measures **614px**.

That mattered. The first plan was collision-only offset from `lg` up, which was reported
as clearing the Leave control by 23px at 1024px. With the real bar the offset is 154px
and it lands 4px *onto* Leave — the first end-to-end run failed at exactly that width.
Hence the `xl` threshold: below it, the geometry is removed rather than sized around.

It is also the case for the guard. "The offset is smaller than the gap" is only true of
the bar you measured, and the bar grows every time a control is added.

## The grid, and its own defect

The brief's hypothesis was worth testing: could the grid scale tiles down, holding
aspect, and wrap as needed, instead of hard-shifting? **It already did.**
`fitMixedRows` is a justified packer — it tries every row count, scales each row to
fill the width, keeps each tile's snapped aspect, and picks the arrangement that
maximises the smallest tile. `useElementSize` re-measures through the 220ms transition
with a 2px threshold so that doesn't become per-frame jank.

The defect was next door, in `gridCapacity`: it decided *how many* tiles to show from
the **narrowed** stage width. Docking the panel therefore took the grid from 4 columns
to 3 at 1024px, capacity from 16 to 12, and four people to page 2 — not scaled down,
gone.

`gridCapacity` now lives in `src/lib/gridCapacity.ts` and is fed the width the stage
would have with **no panel docked** (`dockedStageInset`), by both the grid and the
presentation filmstrip. The packer still lays out in the real, narrowed width, so
docking is now purely "tiles get smaller". Measured with ten real participants at
1024×420: **8 tiles → 6 before, 8 → 8 after.**

It also stops the toggle unmounting and remounting video the client had already
decoded, which was churn nobody asked for.

## Tests

- `src/lib/panelDock.test.ts` — the bar offset never lands in the Leave band at any
  width, scales with the bar, and has ~150px of headroom at `xl` before it could.
- `src/lib/gridCapacity.test.ts` — capacity is identical panel-open and panel-closed
  across every desktop width and crowd size, on touch, and under an explicit gallery
  size; pins the exact drop it prevents (`{cols:4, perPage:16}` → `{cols:3, perPage:12}`);
  and checks `dockedStageInset` against RoomView's Tailwind classes written out
  independently, so the constant can't drift from the CSS unnoticed.
- `tests/21-panel-reflow.spec.ts` — hit-tests the real app at 768/1024/1280/1440: the
  resting pointer never lands on a Leave control, Leave is never buried under the
  panel, and the stage gives up exactly the inset the capacity maths adds back. A
  deliberate press on Leave still leaves first time. Tagged `@heavy`: ten real
  participants confirming the tile count survives the toggle.

Both fixes were mutation-checked — reintroducing the old re-centring fails the reflow
spec at the first width it checks, and reverting the capacity width reproduces 8 → 6.
