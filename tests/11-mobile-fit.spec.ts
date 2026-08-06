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
})
