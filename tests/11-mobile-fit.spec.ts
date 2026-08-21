import { test, expect } from '@playwright/test'
import { uniqueRoom, join, newParticipant, revealChrome, closePanel } from './helpers'
import { ISLAND_H, ISLAND_INSET } from '../src/lib/chromeBands'

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
        const fixed = island.closest('.fixed')!.getBoundingClientRect()
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          controls,
          band: Math.round(window.innerHeight - fixed.top),
        }
      })

    expect(box.left, 'island not clipped on the left').toBeGreaterThanOrEqual(0)
    expect(box.right, 'island not clipped on the right').toBeLessThanOrEqual(vp.width)
    const tooSmall = box.controls.filter((c) => c.h > 0 && c.h < 44)
    expect(tooSmall, 'every control clears 44px').toEqual([])
    // `chromeBands.ISLAND_H` is the one number in that module not read from the
    // platform, and the stage reserves its band from it. Pin it to the bar as
    // actually rendered, so restyling the island can't quietly un-reserve the space
    // the gallery scrolls its last row into. (This device reports no safe-area
    // inset, so the band is the 1rem floor plus the island's height.)
    expect(box.band, 'the reserved band matches islandBand(0)').toBe(ISLAND_INSET + ISLAND_H)
  })

  /**
   * A speaker change must not reshuffle the gallery.
   *
   * This began as a paging bug — the pager sliced one ordered list by index, so a
   * membership change renumbered everyone and tiles jumped pages mid-sentence — and
   * the paging is gone now. The property it was protecting is not: a list that
   * reorders under a thumb is just as bad in a scroller, where the tile you were
   * looking at slides out from under you instead of vanishing to another page.
   *
   * So membership and order still change only on deliberate events (someone joins
   * or leaves, a share starts or stops leading, self-view is toggled) and never on
   * speech. Asserted the same way: the same set of tiles before and after someone
   * else starts talking.
   */
  test('a speaker change does not reshuffle the gallery', async ({ page, browser }) => {
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
      await Promise.all(peers.map((p) => p.context.close()))
    }
  })

  /**
   * Changing view is a named control, not a gesture.
   *
   * The stage used to be a horizontal page sequence — page 0 the focus feed, 1..n
   * gallery pages — switched by swiping, with a row of 1.5px dots underneath as the
   * only hint that any of it existed. Nobody found the gallery on purpose and
   * nobody who swiped into it knew how to get back. It is now a chip that says what
   * you are looking at and opens a menu of the three views, which is what Teams,
   * Meet and WhatsApp all put on a phone call.
   *
   * Asserts the chip is there, says "Speaker" on arrival (a call opens on whoever
   * is talking, not on a grid), and actually changes the view.
   */
  test('the stage view chip names the current view and switches it', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
    ])
    try {
      await page.waitForTimeout(1500)

      // Deliberately NOT part of the auto-hiding chrome: the only route between
      // views must not disappear four seconds after the last tap.
      const chip = page.getByRole('button', { name: /^View: / })
      await expect(chip).toBeVisible({ timeout: 45_000 })
      await expect(chip).toHaveAccessibleName(/^View: Speaker/)

      await chip.tap()
      await page.getByRole('menuitem', { name: 'Gallery' }).tap()
      await expect(chip).toHaveAccessibleName(/^View: Gallery/)

      // …and the gallery still fits the phone. That is the whole point of it.
      expect(await pageOverflow(page)).toBeLessThanOrEqual(2)

      await chip.tap()
      await page.getByRole('menuitem', { name: 'Speaker' }).tap()
      await expect(chip).toHaveAccessibleName(/^View: Speaker/)
    } finally {
      await Promise.all(peers.map((p) => p.context.close()))
    }
  })

  /**
   * You must be able to see yourself, at a size that answers the question.
   *
   * The self-view was a 96px card — too small to tell whether you were in frame,
   * which is the one thing a self-view is for — and it was suppressed entirely
   * during a screen share. It is now a third of the viewport, present on every
   * view, and a tap opens it to roughly double that.
   */
  test('the self-view is legible and opens on tap', async ({ page, browser }) => {
    const vp = page.viewportSize()!
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peer = await newParticipant(browser, room, 'Guest1')
    try {
      // Not a fixed wait: `join()` is satisfied by the PREJOIN screen's own
      // microphone button, so it can return while the room is still connecting.
      // The self-view card only exists in-call, so waiting for it is the check.
      const self = page.getByRole('group', { name: /^Your video/ })
      await expect(self).toBeVisible({ timeout: 45_000 })

      const collapsed = (await self.boundingBox())!
      expect(collapsed.width, 'a glance-able but legible self-view').toBeGreaterThanOrEqual(
        vp.width * 0.28,
      )

      await self.tap()
      await page.waitForTimeout(400)
      const expanded = (await self.boundingBox())!
      expect(expanded.width, 'tapping opens it').toBeGreaterThan(collapsed.width * 1.4)

      // …and it still clears the control island, at either size.
      const barTop = await page
        .getByRole('button', { name: 'Leave call' })
        // offsetTop, not a client rect: the island slides out of the thumb zone with
        // a TRANSFORM on auto-hide, which a rect includes and offsetTop doesn't. A
        // hidden bar reports a top below the fold, and every "clears the bar"
        // assertion measured against it passes for the wrong reason.
        .evaluate((el) => (el.closest('.fixed') as HTMLElement).offsetTop)
      expect(expanded.y + expanded.height).toBeLessThanOrEqual(barTop + 1)
    } finally {
      await peer.context.close()
    }
  })

  /**
   * The gallery must clear the floating control island.
   *
   * Only SoloStage ever reserved a band for it (`pb-24`), which is how the speaker
   * filmstrip ended up with 60 of its 96px underneath the bar. Every tiled layout
   * now reserves ISLAND_BAND — including the scroller, as bottom padding, so the
   * last row can be scrolled clear of the bar instead of parking under it. A single
   * full-bleed feed deliberately doesn't, the way a video player puts its controls
   * on glass.
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
        // offsetTop, not a client rect: the island slides out of the thumb zone with
        // a TRANSFORM on auto-hide, which a rect includes and offsetTop doesn't. A
        // hidden bar reports a top below the fold, and every "clears the bar"
        // assertion measured against it passes for the wrong reason.
        .evaluate((el) => (el.closest('.fixed') as HTMLElement).offsetTop)
      const lowestTile = await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll('[role="group"][aria-label]'))
          .filter((e) => (e as HTMLElement).offsetHeight > 40)
        return Math.max(0, ...tiles.map((e) => e.getBoundingClientRect().bottom))
      })
      expect(lowestTile, 'no tile reaches into the control island band').toBeLessThanOrEqual(barTop + 1)
    } finally {
      await Promise.all(peers.map((p) => p.context.close()))
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

  /**
   * The band reserved for the control island has to track the island, not a number
   * that happens to equal it.
   *
   * The island sits at `bottom: max(1rem, env(safe-area-inset-bottom))` and is 60px
   * tall. Stage reserved a flat 76px — exactly `16 + 60`, and therefore correct only
   * where the bottom inset is 0. Every emulated device Playwright ships reports 0, so
   * the suite agreed with the constant on every viewport it drove and on none of the
   * ones with a home indicator or a gesture bar, where the bar floats HIGHER than its
   * band and the last gallery row can't be scrolled out from under it.
   *
   * So this forces a 34px inset (iOS home indicator) onto both halves — the probe
   * `useSafeAreaBottom` measures, and the island's own offset — and checks they still
   * agree. With the constant back in place the scroller under-reserves by 18px and
   * the last row lands under the bar.
   */
  test('the gallery clears the control island on a device with a home indicator', async ({
    page,
    browser,
  }) => {
    const SAFE_B = 34
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all(
      ['Abena', 'Ama', 'Kofi', 'Kojo', 'Yaw'].map((n) => newParticipant(browser, room, n)),
    )
    try {
      // Via the view chip, not More → Grid: the chip never auto-hides, so the setup
      // can't lose a race with the control island sliding out of the thumb zone.
      const chip = page.getByRole('button', { name: /^View: / })
      await expect(chip).toBeVisible({ timeout: 45_000 })
      await chip.tap()
      await page.getByRole('menuitem', { name: 'Gallery' }).tap()
      await expect(chip).toHaveAccessibleName(/^View: Gallery/)
      await page.waitForTimeout(500)

      await page.addStyleTag({ content: `[data-safe-area-probe]{height:${SAFE_B}px !important}` })
      await page.evaluate((sb) => {
        const bar = document.querySelector('button[aria-label="Leave call"]')
        bar?.closest('.fixed')?.setAttribute('style', `bottom:${sb}px`)
        window.dispatchEvent(new Event('resize'))
      }, SAFE_B)
      await page.waitForTimeout(300)

      const scrolled = await page.evaluate(() => {
        const sc = Array.from(document.querySelectorAll('div')).find(
          (d) => d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200,
        )
        if (!sc) return false
        sc.scrollTop = sc.scrollHeight
        return true
      })
      expect(scrolled, 'six people should not fit without scrolling').toBe(true)
      await page.waitForTimeout(300)

      const { barTop, lowestTile, vh } = await page.evaluate(() => {
        const bar = document.querySelector('button[aria-label="Leave call"]')!.closest('.fixed') as HTMLElement
        const tiles = Array.from(document.querySelectorAll('[role="group"][aria-label]')).filter(
          (e) => (e as HTMLElement).offsetHeight > 40 && !e.getAttribute('aria-label')!.includes('drag'),
        )
        return {
          barTop: bar.offsetTop,
          vh: window.innerHeight,
          lowestTile: Math.max(...tiles.map((e) => e.getBoundingClientRect().bottom)),
        }
      })
      expect(barTop, 'the island rests on screen').toBeGreaterThan(0)
      expect(barTop, 'the island rests on screen').toBeLessThan(vh)
      expect(lowestTile, 'the last row scrolls clear of the bar').toBeLessThanOrEqual(barTop + 1)
    } finally {
      await Promise.all(peers.map((p) => p.context.close()))
    }
  })

})
