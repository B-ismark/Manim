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
  test('an open audio tray keeps the control island on screen (no orphaned menu)', async ({ page }) => {
    const vp = page.viewportSize()!
    await join(page, uniqueRoom(), 'Solo')
    await revealChrome(page)

    const leave = page.getByRole('button', { name: 'Leave call' })
    const inThumbZone = async () => {
      const box = await leave.boundingBox()
      return !!box && box.y < vp.height - 4
    }

    const trigger = page.getByRole('button', { name: /Audio (output|settings)/ })
    await trigger.tap()
    const tray = page.getByRole('group', { name: 'Audio settings' })
    await expect(tray).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Past the 4s auto-hide with room to spare. The tray is part of the island
    // now, so this checks the island doesn't take the tray off screen with it —
    // the tray can't be *separated* from its anchor by construction any more.
    await page.waitForTimeout(6000)
    expect(await inThumbZone(), 'the island stayed in the thumb zone').toBe(true)
    await expect(tray).toBeVisible()

    // Close it the way a phone user does — tap the trigger again. (Not Escape:
    // mobile is pure touch, and not an outside tap either, which would ALSO hit
    // the stage's tap-to-toggle and hide the bar for the wrong reason.)
    await trigger.tap()
    await expect(tray).toBeHidden()

    // Auto-hide must come back — the island is pinned by what's open, not
    // permanently. The tap above also restarts the countdown, so this waits from
    // there.
    await page.waitForTimeout(6000)
    expect(await inThumbZone(), 'the auto-hide resumed once the tray closed').toBe(false)
  })

  /**
   * The control island must fit the screen it's on.
   *
   * Nothing checked this, and it had been failing: at 375px the island has 343px to
   * work with, and a HOST's bar wanted 372px (414 with the room-locked pill) because
   * of the split leave-and-end control. Over-wide controls don't compress — `size-11`
   * fixes both axes — so the island rendered at its natural width and hung off both
   * screen edges, with the mic on one side and leave on the other partly unreachable.
   * The responsive audit never caught it because it can't reach an in-call surface.
   *
   * Asserts the island's box is inside the viewport and every control still clears
   * 44px, so a fix can't be "shrink the buttons".
   */
  test('the control island fits the viewport, with 44px targets', async ({ page }) => {
    const vp = page.viewportSize()!
    await join(page, uniqueRoom(), 'Solo')
    await revealChrome(page)
    await page.waitForTimeout(400)

    const box = await page
      .getByRole('button', { name: 'Leave call' })
      .evaluate((el) => {
        const island = el.closest('div')!.parentElement!
        const r = island.getBoundingClientRect()
        const controls = Array.from(island.querySelectorAll('button')).map((b) => {
          const cr = b.getBoundingClientRect()
          return { w: Math.round(cr.width), h: Math.round(cr.height) }
        })
        return { left: Math.round(r.left), right: Math.round(r.right), controls }
      })

    expect(box.left, 'island not clipped on the left').toBeGreaterThanOrEqual(0)
    expect(box.right, 'island not clipped on the right').toBeLessThanOrEqual(vp.width)
    const tooSmall = box.controls.filter((c) => c.h > 0 && c.h < 44)
    expect(tooSmall, 'every control clears 44px').toEqual([])
  })

  /**
   * A speaker change must not move anyone between gallery pages.
   *
   * The pager slices one ordered list by index, so that list's MEMBERSHIP has to be
   * stable. The tempting definition — "everyone the focus page isn't showing" —
   * excludes the focused track, and the focus follows the active speaker, so every
   * "yeah" from across the room swapped one member for another and renumbered
   * everyone between them. Tiles jumping mid-sentence is what tilePriority's stable
   * sort and the sticky featured share both exist to prevent.
   *
   * The fix is that the gallery holds everyone, speaker included — so they appear
   * big on page 0 AND as a cell, which is what Zoom does. This asserts the tiles on
   * a gallery page are the same set before and after someone else starts talking.
   */
  test('a speaker change does not reshuffle gallery pages', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
      newParticipant(browser, room, 'Guest3'),
    ])
    try {
      await page.waitForTimeout(2000)
      await revealChrome(page)
      await page.getByRole('button', { name: 'More options' }).tap()
      await page.getByRole('button', { name: 'Grid', exact: true }).tap()
      await closePanel(page)
      await page.waitForTimeout(600)

      const names = () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="group"][aria-label]'))
            .filter((e) => (e as HTMLElement).offsetHeight > 60)
            .map((e) => e.getAttribute('aria-label')!.split(',')[0])
            .sort(),
        )

      const before = await names()
      expect(before.length, 'a gallery page is showing tiles').toBeGreaterThan(0)
      // Let the fake-media audio drive `isSpeaking` around for a few cycles.
      await page.waitForTimeout(4000)
      expect(await names(), 'the same people are on this page').toEqual(before)
    } finally {
      await Promise.all(peers.map((p) => p.close()))
    }
  })

  /**
   * The stage is one horizontal page sequence, and speaker view is page 0.
   *
   * Swipe used to toggle grid/speaker, which took the gesture a phone user reaches
   * for to turn a page — so the gallery pager fell back to two arrow buttons
   * floating in the middle of the video. Now the swipe is the pager AND the mode
   * switch, because there is no mode: page 0 is the focus feed, 1..n are gallery
   * pages, and the dots advertise that they exist.
   */
  test('swiping the stage moves along the page sequence, starting from the speaker', async ({ page, browser }) => {
    const vp = page.viewportSize()!
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
    ])
    try {
      await page.waitForTimeout(1500)
      await revealChrome(page)

      // Page 0 by default — a call opens on whoever is talking, not on a grid.
      const dots = page.getByRole('button', { name: /^(Speaker view|Gallery page )/ })
      await expect(dots.first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Speaker view' })).toHaveAttribute('aria-current', 'true')

      // Swipe left → the first gallery page.
      const mid = { x: Math.round(vp.width / 2), y: Math.round(vp.height / 2) }
      await page.touchscreen.tap(mid.x, mid.y) // ensure the stage has the gesture
      await page.mouse.move(mid.x + 90, mid.y)
      await page.mouse.down()
      await page.mouse.move(mid.x - 90, mid.y, { steps: 8 })
      await page.mouse.up()
      await expect(page.getByRole('button', { name: /^Gallery page 1/ })).toHaveAttribute('aria-current', 'true')

      // …and the page must still fit. This is the whole point of paging.
      expect(await pageOverflow(page)).toBeLessThanOrEqual(2)
    } finally {
      await Promise.all(peers.map((p) => p.close()))
    }
  })

  /**
   * The gallery must clear the floating control island.
   *
   * Only SoloStage ever reserved a band for it (`pb-24`), which is how the speaker
   * filmstrip ended up with 60 of its 96px underneath the bar. Tiled pages now
   * reserve ISLAND_BAND; the focus page deliberately doesn't, the way a video
   * player puts its controls on glass.
   */
  test('gallery tiles clear the control island', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
      newParticipant(browser, room, 'Guest3'),
    ])
    try {
      await page.waitForTimeout(1500)
      await revealChrome(page)
      await page.getByRole('button', { name: 'More options' }).tap()
      await page.getByRole('button', { name: 'Grid', exact: true }).tap()
      await closePanel(page)
      await revealChrome(page)
      await page.waitForTimeout(500)

      const barTop = await page
        .getByRole('button', { name: 'Leave call' })
        .evaluate((el) => el.closest('div')!.getBoundingClientRect().top)
      const lowestTile = await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll('[role="group"][aria-label]'))
          .filter((e) => (e as HTMLElement).offsetHeight > 40)
        return Math.max(0, ...tiles.map((e) => e.getBoundingClientRect().bottom))
      })
      expect(lowestTile, 'no tile reaches into the control island band').toBeLessThanOrEqual(barTop + 1)
    } finally {
      await Promise.all(peers.map((p) => p.close()))
    }
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
    const trigger = page.getByRole('button', { name: /Audio (output|settings)/ })
    await trigger.tap()
    const tray = page.getByRole('group', { name: 'Audio settings' })
    await expect(tray).toBeVisible()
    await expect(tray.getByText('Microphone', { exact: true })).toBeVisible()
    await trigger.tap()
    await expect(tray).toBeHidden()

    await revealChrome(page)
    await page.getByRole('button', { name: 'More options' }).tap()
    await expect(page.getByRole('button', { name: 'Audio & video' })).toBeVisible()
    await closePanel(page)
  })
})
