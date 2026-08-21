import { test, expect } from '@playwright/test'
import { uniqueRoom, join, newParticipant, revealChrome, closePanel } from './helpers'

/**
 * Mobile real-estate: the core surfaces must FIT the viewport — a phone user
 * should never have to scroll to reach primary UI (the one allowed exception is
 * the chat message list). Asserts the page itself doesn't overflow vertically;
 * panels (More / chat) may scroll INTERNALLY, but the page must not. Mobile
 * project only.
 */
test.describe('Mobile fit (no page scroll)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'touch projects only (mobile, mobile-sm)')
  })

  const pageOverflow = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

  test('landing fits', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
    expect(await pageOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('prejoin fits', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800) // camera tile settles
    expect(await pageOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('in-call (solo) fits', async ({ page }) => {
    await join(page, uniqueRoom(), 'Solo')
    await page.waitForTimeout(1500)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('in-call grid (2-party) fits', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peer = await newParticipant(browser, room, 'Guest')
    await page.waitForTimeout(1500)
    const over = await pageOverflow(page)
    await peer.context.close()
    expect(over).toBeLessThanOrEqual(2)
  })

  /**
   * A phone must show ALL of a laptop's landscape frame, not a portrait crop of it.
   *
   * In a 1-on-1 the phone routes to the focus layout, whose tile is as tall as the
   * stage. Filling that box with a 16:9 camera (object-cover) threw away most of the
   * frame's width — which is how someone sitting off to one side vanishes from the
   * call. The tile letterboxes instead once the two shapes disagree badly enough, so
   * the whole frame survives; black bars are the accepted cost.
   *
   * Asserts the RENDERED content box, not the CSS property: what matters is that the
   * painted video is as wide as its source is, relative to its height.
   */
  test('a landscape sender is shown whole, not cropped to portrait', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Phone')
    // The peer is pinned to a desktop context so it publishes a LANDSCAPE camera —
    // the shape a phone viewer has to accommodate.
    const peer = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
      isMobile: false,
      deviceScaleFactor: 1,
    })
    const peerPage = await peer.newPage()
    await join(peerPage, room, 'Laptop')

    try {
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('video')).some(
            (v) => v.videoWidth > v.videoHeight && v.clientHeight > 200,
          ),
        { timeout: 30_000 },
      )
      await page.waitForTimeout(1200) // aspect reported, layout settled

      const fit = await page.evaluate(() => {
        // The big focus tile: the largest rendered video carrying a landscape frame.
        const v = Array.from(document.querySelectorAll('video'))
          .filter((el) => el.videoWidth > el.videoHeight)
          .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
        if (!v) return null
        const box = v.clientWidth / v.clientHeight
        const src = v.videoWidth / v.videoHeight
        // Fraction of the source frame actually painted, under object-fit.
        const shown = getComputedStyle(v).objectFit === 'contain' ? 1 : Math.min(1, box / src)
        return { box, src, shown, objectFit: getComputedStyle(v).objectFit }
      })

      expect(fit, 'the phone is showing the laptop feed').not.toBeNull()
      // Cover would show box/src of the width — about 30% for 9:16-ish in 16:9.
      expect(fit!.shown, 'the whole landscape frame reaches the phone').toBeGreaterThan(0.95)
    } finally {
      await peer.close()
    }
  })

  test('More sheet open — page stays fixed (sheet scrolls internally, not the page)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Solo')
    await revealChrome(page)
    await page.getByRole('button', { name: 'More options' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(2)
    await closePanel(page)
  })

  /**
   * The orphaned-island bug: an open picker must never outlive its own anchor.
   *
   * The control bar auto-hides after 4s of stage idleness, and that countdown used
   * to run regardless of what was open on top of it. Open the audio picker, wait,
   * and the island slid out of the thumb zone while the popover stayed put — a menu
   * floating over the stage attached to nothing, with the bar it belonged to gone.
   *
   * Waits well past the hide delay (4s) and asserts the island is still in the
   * thumb zone with the picker still on it. Also asserts the countdown resumes:
   * close the picker, wait again, and the bar hides normally — a fix that simply
   * pinned the chrome forever would pass the first half and fail here.
   */
  test('an open device picker keeps the control island anchored (no orphaned menu)', async ({ page }) => {
    const vp = page.viewportSize()!
    await join(page, uniqueRoom(), 'Solo')
    await revealChrome(page)

    const leave = page.getByRole('button', { name: 'Leave call' })
    const inThumbZone = async () => {
      const box = await leave.boundingBox()
      return !!box && box.y < vp.height - 4
    }

    await page.getByRole('button', { name: 'Audio output' }).tap()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Past the 4s auto-hide with room to spare.
    await page.waitForTimeout(6000)
    expect(await inThumbZone(), 'the island stayed put under its open picker').toBe(true)
    await expect(page.getByRole('dialog')).toBeVisible()

    // Close it the way a phone user does — tap the trigger again. (Not Escape:
    // mobile is pure touch, and not an outside tap either, which would ALSO hit
    // the stage's tap-to-toggle and hide the bar for the wrong reason.)
    await page.getByRole('button', { name: 'Audio output' }).tap()
    await expect(page.getByRole('dialog')).toBeHidden()

    // Auto-hide must come back — the island is pinned by the open layer, not
    // permanently. The tap above also restarts the countdown, so this waits from
    // there.
    await page.waitForTimeout(6000)
    expect(await inThumbZone(), 'the auto-hide resumed once the picker closed').toBe(false)
  })

  /**
   * Controls that were only ever meant for a mouse must not reach a thumb.
   *
   * The mic/camera device carets gated themselves with `hidden
   * pointer-fine:inline-flex`, which is inert on an IconButton (its own base
   * `inline-flex` wins the cascade against an equal-specificity `.hidden` emitted
   * earlier). They rendered on phones, where the caret is a 36px target that opens
   * a popover of nested dropdowns. Touch reaches the same devices through the
   * Output button and "Audio & video" in More, which is asserted here too so this
   * can't pass by the pickers simply being gone.
   */
  test('desktop-only device carets stay off the touch control bar', async ({ page }) => {
    await join(page, uniqueRoom(), 'Solo')
    await revealChrome(page)

    await expect(page.getByRole('button', { name: 'Audio options' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Camera options' })).toHaveCount(0)

    // …and the devices behind them are still reachable on touch.
    await page.getByRole('button', { name: 'Audio output' }).tap()
    const picker = page.getByRole('dialog')
    await expect(picker).toBeVisible()
    await expect(picker.getByText('Microphone', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Audio output' }).tap()
    await expect(picker).toBeHidden()

    await revealChrome(page)
    await page.getByRole('button', { name: 'More options' }).tap()
    await expect(page.getByRole('button', { name: 'Audio & video' })).toBeVisible()
    await closePanel(page)
  })
})
