import { test, expect, type Page } from '@playwright/test'
import { uniqueRoom, join, revealChrome, fakeScreenShare, startScreenShare, isTouch } from './helpers'

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
  await revealChrome(page)

  await expect(page.getByText(/You’re sharing your screen|You’re drawing/)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByLabel('Call duration')).toBeVisible()
  await page.waitForTimeout(400) // let the column settle

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
  }
})

test('only one modal surface is ever mounted', async ({ page }) => {
  test.setTimeout(120_000)
  test.skip(await isTouch(page), 'uses the desktop More popover + keyboard shortcuts')
  await join(page, uniqueRoom('layers'), 'Ada')
  await revealChrome(page)

  const openFromMore = async (item: RegExp) => {
    await page.getByRole('button', { name: 'More options' }).click()
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
