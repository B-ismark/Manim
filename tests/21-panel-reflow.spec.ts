import { test, expect, type Page } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join, isTouch } from './helpers'

/**
 * Opening the chat/people panel must never park a call-ending control under a
 * pointer that hasn't moved.
 *
 * The bar used to re-centre in whatever space the docked panel left over, which
 * slid it left by half the panel's width — 160/176/200px. The Leave control sits
 * 151-280px right of the Chat button that triggers the reflow, so at every
 * desktop breakpoint the slide put Leave exactly where the user's cursor already
 * was: click chat, click the same spot to close it, and you've left the call.
 * Only the 8s Rejoin toast made that survivable.
 *
 * These assertions are hit-tests, not pixel budgets, so they keep holding as the
 * bar's contents change. See lib/panelDock and docs/panel-reflow-findings.md.
 */

/** Centre of an element, in page coordinates. */
async function centre(page: Page, name: string) {
  const box = await page.getByRole('button', { name, exact: true }).first().boundingBox()
  if (!box) throw new Error(`no bounding box for "${name}"`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** What sits on top at this point: a Leave control, the bar, or something else. */
function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px as number, py as number)
      if (!el) return 'nothing'
      if (el.closest('[aria-label="Leave call"], [aria-label="End call for everyone"]')) return 'leave'
      return el.closest('[aria-label]')?.getAttribute('aria-label') ?? el.tagName.toLowerCase()
    },
    [x, y],
  )
}

test.describe('Side panel reflow', () => {
  test('opening the panel never slides a Leave control under a resting pointer', async ({ page }) => {
    test.skip(await isTouch(page), 'the docked panel and the hover pointer are desktop-only')
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')

    // Every desktop width the panel behaves differently at: it overlays below lg,
    // docks and shifts the bar at lg/xl, and docks with no shift at all once the
    // bar already clears it.
    for (const width of [768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await page.waitForTimeout(400)

      // Rest the pointer on Chat and press it, exactly as a user does.
      const resting = await centre(page, 'Open chat')
      await page.mouse.move(resting.x, resting.y)
      await page.mouse.down()
      await page.mouse.up()
      await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
      await page.waitForTimeout(400) // --dur-base, plus room

      expect(
        await hitAt(page, resting.x, resting.y),
        `at ${width}px the pointer ended up on a Leave control without moving`,
      ).not.toBe('leave')

      // ...and the panel must not have buried the bar instead: Leave still has to
      // be the topmost thing at its own centre, or it can't be pressed at all.
      const leave = await centre(page, 'Leave call')
      expect(
        await hitAt(page, leave.x, leave.y),
        `at ${width}px the Leave control is covered by something else`,
      ).toBe('leave')

      await page.getByRole('button', { name: 'Close panel' }).last().click()
      await page.waitForTimeout(400)
    }

    expect(await appErrors(sink)).toEqual([])
  })

  test('a deliberate press on Leave still leaves immediately', async ({ page }) => {
    test.skip(await isTouch(page), 'desktop pointer behaviour')
    await join(page, uniqueRoom(), 'Ada')
    // xl, the one range where the panel sits beside the bar and the bar really
    // does shift — so the settle guard actually arms and has to be disarmed.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(400)

    await page.getByRole('button', { name: 'Open chat' }).click()
    await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
    await page.waitForTimeout(400)

    // The guard must only ever reject a click the pointer never aimed. Travelling
    // to Leave and pressing it is aimed, so it has to work first time — no second
    // press, no confirmation.
    await page.getByRole('button', { name: 'Leave call', exact: true }).first().click()
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeHidden({
      timeout: 20_000,
    })
    await expect(page).toHaveURL(/\/$/)
  })
})
