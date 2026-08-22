import { test, expect, type Page } from '@playwright/test'
import {
  uniqueRoom,
  join,
  openMore,
  revealChrome,
  expectChromeVisible,
  fakeScreenShare,
  startScreenShare,
  isTouch,
} from './helpers'

/**
 * Overlay layering.
 *
 * Every top banner and pill used to place itself — its own `fixed`, its own top
 * offset, its own z-index — and four of them had independently landed on the same
 * offset. Two on screen together printed over each other, and which one won was
 * decided by whichever z-index its author happened to pick.
 *
 * The existing overlap sweep in 09-visual only looks at BUTTONS and links, so it
 * never saw this: the status chip and the presenting pill are plain text. These
 * tests check the pills themselves, and check the invariant that makes them safe —
 * one stacking column, one modal at a time.
 */

/** Bounding boxes of the top overlay column's rows, top to bottom. */
async function stackRows(page: Page) {
  return page.evaluate(() => {
    const stack = document.querySelector<HTMLElement>('[data-testid="top-stack"]')
    if (!stack) return null
    return Array.from(stack.children)
      .map((c) => {
        const r = c.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: (c.textContent || '').trim().slice(0, 40) }
      })
      .filter((r) => r.bottom > r.top)
  })
}

test('top banners queue in one column instead of stacking on each other', async ({ page }) => {
  test.setTimeout(150_000)
  test.skip(await isTouch(page), 'the presenting pill needs a desktop screen share')
  const room = uniqueRoom('layers')

  // Two top overlays at once: the always-on call status chip, and the presenting
  // pill that appears with a share. Before the stack, these were two independent
  // `fixed` elements whose offsets were hand-tuned to miss each other.
  await fakeScreenShare(page, 1280, 720)
  await join(page, room, 'Presenter')
  await startScreenShare(page)

  await expect(page.getByText(/You’re sharing your screen|You’re drawing/)).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(400) // let the column settle

  // Reveal LAST, immediately before the measurement. The timer lives in
  // CallStatusBar, which unmounts with the touch chrome — so a reveal taken before
  // a 30s wait has long since expired by the time the rows are read, and the column
  // being measured is missing a row rather than mis-stacked.
  await expectChromeVisible(page, page.getByLabel('Call duration'))
  const rows = await stackRows(page)
  expect(rows, 'the top overlay column exists').not.toBeNull()
  expect(rows!.length, 'both overlays are in it').toBeGreaterThanOrEqual(2)

  // THE ASSERTION: no two rows share vertical space. A column can only violate
  // this by someone re-introducing absolute positioning inside it.
  for (let i = 1; i < rows!.length; i++) {
    const above = rows![i - 1]
    const below = rows![i]
    expect(
      below.top,
      `"${below.text}" starts before "${above.text}" ends — the banners are overlapping`,
    ).toBeGreaterThanOrEqual(above.bottom - 1)
    // …and they're packed, not spaced out. A pill that hides by translating away
    // instead of unmounting still holds its slot AND its gap, leaving an empty
    // band and pushing everything under it down the screen.
    expect(
      below.top - above.bottom,
      `a phantom slot sits between "${above.text}" and "${below.text}"`,
    ).toBeLessThan(24)
  }
})

/**
 * The same rule, one level down: inside a video tile.
 *
 * The shared-screen tile carries three controls in its top-right corner — demote,
 * fullscreen, annotate — and each of them used to pick its own vertical offset
 * (`top-2`, `top-14`, `top-[6.5rem]`), which is three independent assumptions about
 * the other two's heights. Nothing checked them, so the collision only showed up on
 * a short big region, where the third one ran into the name pill.
 *
 * Asserts three things a hand-tuned column can silently lose: the controls don't
 * overlap each other, they stay packed (no phantom gap from a control that hides by
 * fading rather than unmounting), and they stay clear of the name pill at the bottom.
 */
test('tile corner controls queue in one column instead of overlapping', async ({ page }) => {
  test.setTimeout(150_000)
  test.skip(await isTouch(page), 'the annotate control is desktop-only')
  const room = uniqueRoom('tilestack')

  await fakeScreenShare(page, 1280, 720, 10, 'window')
  await join(page, room, 'Presenter')
  await startScreenShare(page)
  await revealChrome(page)
  await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

  // Hover the tile so the desktop reveal-on-hover action is actually rendered.
  await page.getByTestId('tile-action-stack').first().hover()
  await page.waitForTimeout(300)

  const rows = await page.evaluate(() => {
    const stack = document.querySelector('[data-testid="tile-action-stack"]')
    if (!stack) return null
    return Array.from(stack.querySelectorAll('button'))
      .map((b) => {
        const r = b.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, label: b.getAttribute('aria-label') ?? '' }
      })
      .filter((r) => r.bottom > r.top)
      .sort((a, b) => a.top - b.top)
  })

  expect(rows, 'the tile action stack exists').not.toBeNull()
  expect(rows!.length, 'demote + fullscreen + annotate are all in it').toBeGreaterThanOrEqual(3)

  for (let i = 1; i < rows!.length; i++) {
    const above = rows![i - 1]
    const below = rows![i]
    expect(
      below.top,
      `"${below.label}" starts before "${above.label}" ends — the tile controls overlap`,
    ).toBeGreaterThanOrEqual(above.bottom - 1)
    expect(
      below.top - above.bottom,
      `a phantom slot sits between "${above.label}" and "${below.label}"`,
    ).toBeLessThan(24)
  }

  // The bottom of the column must clear the tile's own name pill — the collision
  // the third hand-picked offset actually produced on a short big region.
  const clears = await page.evaluate(() => {
    const stack = document.querySelector('[data-testid="tile-action-stack"]')
    const tile = stack?.closest('[role="group"]')
    const pill = tile?.querySelector('span[aria-hidden]')
    if (!stack || !pill) return null
    return pill.getBoundingClientRect().top - stack.getBoundingClientRect().bottom
  })
  expect(clears, 'the tile name pill was found').not.toBeNull()
  expect(clears!, 'the action column runs into the name pill').toBeGreaterThan(0)
})

/**
 * A tile's top-left control on touch occupies x 16..60: the stage insets the tile
 * 8px, the control sits `left-2` (8px) inside that, and it is a 44px target. Pinned
 * VISIBLE there, because touch has no hover to reveal it with.
 *
 * Measured across both phone widths and both stage views. Gallery rows start at
 * y=84, clear of the top band entirely — SPEAKER and CONTENT are where a control
 * shares the band with whatever TopStack is showing.
 */
const CORNER_BAND = 60

/**
 * The pin coachmark must not sit on a tile's corner controls.
 *
 * TopStack anchors at `top: max(1rem, safe-area)` and stretches `inset-x-0`, so a
 * child wide enough to reach the corners lands on top of one. This hint did: its
 * text fills the width, and being tap-to-dismiss (`pointer-events-auto`) it
 * swallowed the tap on a host's "Mute <name>" button for its whole 6s life.
 *
 * Asserted as GEOMETRY against the measured band rather than by staging a real
 * collision, and that is the deliberate choice of the two:
 *  - `overlaps()` in 09-visual only reports an intersection above 20% of the
 *    smaller element's area. It caught the original full-width collision at 100%
 *    and said nothing at all about the 4px one an almost-right cap left behind.
 *  - Staging the collision needs the page to be HOST (only a moderator gets "Mute
 *    <name>"), so the page must join first — and then a peer's join eats most of
 *    the 1.5s-to-7.5s window the hint is on screen for. Re-joining to restart that
 *    timer loses host status. Every variant is either racy or quietly vacuous.
 * Solo, the hint appears on a fixed timer and the band is a constant, so this is
 * neither.
 */
test('the pin coachmark clears the tile corner controls', async ({ page }) => {
  test.skip(!(await isTouch(page)), 'the coachmark is touch-only')
  await join(page, uniqueRoom('coach'), 'Host')
  const pill = page.getByRole('button', { name: /^Double-tap a video to pin/ })
  await expect(pill, 'the coachmark showed').toBeVisible({ timeout: 15_000 })

  const box = await page.evaluate(() => {
    const coach = ([...document.querySelectorAll('button')] as HTMLElement[]).find((b) =>
      (b.textContent || '').startsWith('Double-tap a video'),
    )
    if (!coach) return null
    const r = coach.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }
  })
  expect(box, 'the coachmark was found').not.toBeNull()

  expect(box!.left, 'the coachmark reaches into the left corner control').toBeGreaterThan(
    CORNER_BAND,
  )
  expect(
    box!.vw - box!.right,
    'the coachmark reaches into the right corner control',
  ).toBeGreaterThan(CORNER_BAND)

  // And nothing it CAN see is underneath it, at zero tolerance.
  const hits = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button')] as HTMLElement[]
    const coach = all.find((b) => (b.textContent || '').startsWith('Double-tap a video'))!
    const c = coach.getBoundingClientRect()
    return all
      .filter(
        (b) =>
          b !== coach &&
          b.checkVisibility({ opacityProperty: true, visibilityProperty: true } as never),
      )
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          Math.min(c.right, r.right) - Math.max(c.left, r.left) > 0 &&
          Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top) > 0,
      )
      .map(({ b }) => b.getAttribute('aria-label') ?? (b.textContent || '').trim().slice(0, 20))
  })
  expect(hits, JSON.stringify(hits)).toEqual([])
})

test('only one modal surface is ever mounted', async ({ page }) => {
  test.setTimeout(120_000)
  test.skip(await isTouch(page), 'uses the desktop More popover + keyboard shortcuts')
  await join(page, uniqueRoom('layers'), 'Ada')
  await revealChrome(page)

  const openFromMore = async (item: RegExp) => {
    await openMore(page)
    await page.getByRole('button', { name: item }).click()
  }

  await openFromMore(/^Settings$/)
  await expect(page.getByRole('dialog')).toHaveCount(1)

  // The keyboard path is the one that could stack a second dialog on the first —
  // the More menu can't, because an open modal's scrim already covers the bar.
  // '?' opens the shortcuts dialog; with Settings up it must be ignored.
  await page.keyboard.press('?')
  await page.waitForTimeout(300)
  await expect(page.getByRole('dialog'), 'a shortcut must not stack a second dialog').toHaveCount(1)

  // Close, then a different dialog opens cleanly — one in, one out.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await openFromMore(/^Audio & video$/)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('dialog')).toContainText('Audio & video')
})
