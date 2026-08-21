import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join, isTouch } from './helpers'

/**
 * Opening the chat/people panel must never park a call-ending control under a
 * pointer that hasn't moved.
 *
 * The bar used to re-centre in whatever space the docked panel left over, which
 * slid it left by half the panel's width — 160/176/200px. The Leave control sits
 * 151-284px right of the Chat button that triggers the reflow, so at every
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

/**
 * Wait for the control bar to stop moving, rather than guessing at the 220ms
 * reflow with a fixed sleep — this suite runs serially on a 2-core CI runner
 * where a transition can outlast any guess. Resolves once the bar's left edge has
 * held the same whole pixel for 250ms.
 */
async function barSettled(page: Page) {
  await page.evaluate(() => delete (window as unknown as { __barX?: unknown }).__barX)
  await page.waitForFunction(
    () => {
      const bar = document
        .querySelector('[aria-label="Leave call"]')
        ?.closest('div[class*="shadow-raised"]') as HTMLElement | null
      if (!bar) return false
      const w = window as unknown as { __barX?: { x: number; since: number } }
      const x = Math.round(bar.getBoundingClientRect().left)
      const now = performance.now()
      if (!w.__barX || w.__barX.x !== x) {
        w.__barX = { x, since: now }
        return false
      }
      return now - w.__barX.since > 250
    },
    undefined,
    { timeout: 15_000 },
  )
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

/** Participants to try for in the capacity test — see its @heavy note. */
const TARGET = 11
/** What the 1024px stage fits with the panel docked, from lib/tileGrid. */
const NARROWED_FIT = 9

test.describe('Side panel reflow', () => {
  test('opening the panel never slides a Leave control under a resting pointer', async ({ page }) => {
    test.skip(await isTouch(page), 'the docked panel and the hover pointer are desktop-only')
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')

    // Every desktop width the panel behaves differently at: it overlays below lg,
    // docks and shifts the bar at lg/xl, and docks with no shift at all once the
    // bar already clears it.
    // 1279 earns its place: it is the widest viewport where the panel still docks
    // beside a MOTIONLESS bar, so the two overlap horizontally by ~15px and only
    // the panel's vertical clearance keeps Leave pressable.
    for (const width of [768, 1024, 1279, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await barSettled(page)

      // Rest the pointer on Chat and press it, exactly as a user does.
      const resting = await centre(page, 'Open chat')
      await page.mouse.move(resting.x, resting.y)
      await page.mouse.down()
      await page.mouse.up()
      await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
      await barSettled(page)

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
      await barSettled(page)
    }

    expect(await appErrors(sink)).toEqual([])
  })

  /**
   * Tile capacity is decided from the stage's width with the panel's inset added
   * back (lib/panelDock's dockedStageInset), so docking can only shrink tiles and
   * never page people out. That only holds while the constant matches the CSS
   * RoomView actually applies — which is what this checks, at every width.
   */
  test('the stage gives up exactly the inset the capacity maths adds back', async ({ page }) => {
    test.skip(await isTouch(page), 'the panel only reflows the stage on a pointer device')
    await join(page, uniqueRoom(), 'Ada')

    // RoomView: `panel && 'lg:pr-[22rem] xl:pr-[25rem]'`, mirrored by
    // dockedStageInset as 0 / 352 / 400.
    for (const [width, inset] of [[768, 0], [1024, 352], [1280, 400], [1440, 400]] as const) {
      await page.setViewportSize({ width, height: 800 })
      await barSettled(page)

      const pad = () =>
        page.evaluate(() => {
          const stage = document.querySelector('[aria-label="In call"]') as HTMLElement
          return {
            padding: Math.round(parseFloat(getComputedStyle(stage).paddingRight)),
            content: Math.round(stage.getBoundingClientRect().width) - Math.round(parseFloat(getComputedStyle(stage).paddingRight)),
          }
        })

      const closed = await pad()
      expect(closed.padding, `${width}px, panel closed`).toBe(0)

      await page.getByRole('button', { name: 'Open chat' }).click()
      await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
      await barSettled(page)

      const open = await pad()
      expect(open.padding, `${width}px, panel open`).toBe(inset)
      // ...and the width the grid is measured at really does come back to the
      // undocked width when the inset is added on.
      expect(open.content + inset, `${width}px content width`).toBe(closed.content)

      await page.getByRole('button', { name: 'Close panel' }).last().click()
      await barSettled(page)
    }
  })

  /**
   * The user-visible half of the capacity rule: docking the panel repacks people
   * into narrower rows, it does not page any of them out.
   *
   * @heavy — it needs eleven real participants at 1024x500, the cheapest viewport
   * where the column the panel costs is NOT paid back in extra rows: capacity is
   * 12 with the panel closed and 9 from the narrowed stage alone, so everyone past
   * the ninth is who disappears. Measured on this change: 11 -> 9 before,
   * 11 -> 11 after.
   *
   * The assertion is "no fewer", not "the same", because the rule is a max: at
   * widths where the narrower stage fits MORE rows, opening the panel legitimately
   * shows extra people rather than hiding any.
   */
  test('docking the panel shrinks tiles instead of paging people out @heavy', async ({
    page,
    browser,
  }) => {
    test.skip(await isTouch(page), 'the panel only reflows the stage on a pointer device')
    test.setTimeout(300_000)
    const room = uniqueRoom('reflow')
    await join(page, room, 'P00')

    // Join as many as the machine will give us. Spinning eleven real WebRTC
    // contexts is the expensive part and it is the part most likely to fall over
    // on a loaded runner, so a failure to reach the target skips rather than
    // reds — the assertion below only means something when the page is actually
    // capacity-bound, and it says so.
    const extras: BrowserContext[] = []
    for (let i = 1; i < TARGET; i++) {
      const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
      const p: Page = await context.newPage()
      try {
        await join(p, room, `P${String(i).padStart(2, '0')}`)
        extras.push(context)
      } catch {
        await context.close().catch(() => {})
        break
      }
    }
    try {
      await page.setViewportSize({ width: 1024, height: 500 })
      await barSettled(page)

      const tiles = () => page.locator('[aria-label="In call"] [role="group"]').count()
      const closed = await tiles()
      // The narrowed stage fits NINE. Unless more than nine are on screen with the
      // panel shut, nothing here exercises the rule, so don't pretend it did.
      test.skip(
        closed <= NARROWED_FIT,
        `only ${closed} tiles on screen; needs more than ${NARROWED_FIT} to bind capacity`,
      )

      await page.getByRole('button', { name: 'Open chat' }).click()
      await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
      await barSettled(page)

      expect(await tiles(), 'opening the panel paged someone out').toBeGreaterThanOrEqual(closed)
    } finally {
      for (const c of extras) await c.close().catch(() => {})
    }
  })

  test('a deliberate press on Leave still leaves immediately', async ({ page }) => {
    test.skip(await isTouch(page), 'desktop pointer behaviour')
    await join(page, uniqueRoom(), 'Ada')
    // xl, the one range where the panel sits beside the bar and the bar really
    // does shift — so the settle guard actually arms and has to be disarmed.
    await page.setViewportSize({ width: 1280, height: 800 })
    await barSettled(page)

    await page.getByRole('button', { name: 'Open chat' }).click()
    await expect(page.getByRole('combobox', { name: 'Message', exact: true })).toBeVisible()
    await barSettled(page)

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
