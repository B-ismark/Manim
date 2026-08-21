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
