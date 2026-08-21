import { test, expect } from '@playwright/test'
import { uniqueRoom, join, newParticipant, openChat, openMore, revealChrome, selectStageView, closePanel } from './helpers'
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
    await openMore(page)
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
      await openMore(page)
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

      await selectStageView(page, 'Gallery')
      await expect(chip).toHaveAccessibleName(/^View: Gallery/)

      // …and the gallery still fits the phone. That is the whole point of it.
      expect(await pageOverflow(page)).toBeLessThanOrEqual(2)

      await selectStageView(page, 'Speaker')
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
   * during a screen share. It is now a third of the viewport, and a tap opens it to
   * roughly double that.
   *
   * This is the SPEAKER view, which is where a call opens and one of the two views
   * that still floats the card. The gallery gives you a real cell instead — see the
   * test below, which asserts the two never both happen.
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
   * Exactly ONE of you is on screen, and which one depends on the view.
   *
   * The gallery used to have a person-shaped hole in it: you were excluded from the
   * tiles and floated over them as a card instead, which cost you the only view
   * where you appear at the same size and in the same reading order as everyone
   * else. You are a cell there now, the way every desktop layout carries you.
   *
   * The card is NOT gone, because two views have no cell of yours to be in —
   * speaker is one full-bleed feed, and a share puts people on a collapsible
   * thumbnail rail. So the property worth pinning down isn't "card" or "cell", it's
   * that the two never overlap: a card AND a cell would show you to yourself twice,
   * on the pointer type with the least room to spare.
   *
   * Both counts come from one sweep of the accessible names, because that is the
   * only way to catch the failure where each half is individually correct.
   */
  test('you are a gallery cell, and never a cell and a card at once', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
    ])
    try {
      /**
       * How many of each surface is showing you.
       *
       * One sweep rather than two locators, because the card is NOT a sibling of
       * the cells — it wraps a Tile, and that inner Tile carries the very same
       * "(you)" label a cell does. A plain count of `(you)` groups is therefore 1
       * in both views and proves nothing; only the ones OUTSIDE the card are cells.
       * (`tileLabel` renders the local participant as "<name> (you)", so this finds
       * your tile without depending on the display name the join flow used.)
       */
      const surfaces = () =>
        page.evaluate(() => {
          const card = document.querySelector('[role="group"][aria-label^="Your video"]')
          const tiles = Array.from(
            document.querySelectorAll('[role="group"][aria-label*="(you)"]'),
          )
          return {
            card: card ? 1 : 0,
            cells: tiles.filter((t) => !card?.contains(t)).length,
          }
        })

      // Arrive in speaker view: the card, and no cell of yours in the background.
      await expect
        .poll(surfaces, { timeout: 45_000, message: 'speaker view floats the card' })
        .toEqual({ card: 1, cells: 0 })

      await selectStageView(page, 'Gallery')

      // …and in the gallery the two swap over. Not "the cell appears" — the card
      // going away is the half a partial implementation would miss, and the half
      // that costs a phone a tile-sized hole in the middle of the grid.
      await expect
        .poll(surfaces, { timeout: 20_000, message: 'the gallery tiles you instead' })
        .toEqual({ card: 0, cells: 1 })

      // The cell is a real tile, not a sliver: it sits in the grid at the size
      // everyone else's does. A self-view too small to show whether you are in
      // frame is the bug the card was made big to fix, and a cell can reintroduce
      // it — a 96px cell would satisfy every assertion above.
      await page.waitForTimeout(400) // let the packer settle on the reported aspects
      const mine = (await page.getByRole('group', { name: /\(you\)/ }).boundingBox())!
      const theirs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="group"][aria-label]'))
          .filter(
            (e) =>
              !/\(you\)/.test(e.getAttribute('aria-label')!) &&
              (e as HTMLElement).offsetHeight > 60,
          )
          .map((e) => e.getBoundingClientRect().width),
      )
      expect(theirs.length, 'there are other tiles to compare against').toBeGreaterThan(0)
      expect(mine.width, 'your cell is sized like the others').toBeGreaterThanOrEqual(
        Math.min(...theirs) * 0.9,
      )

      // Switching back restores the card — the rule is per-view, not a one-way door.
      await selectStageView(page, 'Speaker')
      await expect
        .poll(surfaces, { timeout: 20_000, message: 'speaker view floats the card again' })
        .toEqual({ card: 1, cells: 0 })

      // "Hide self view" has to reach the cell too. It only ever had a card to hide
      // before, so a filter that stopped at the card would leave the setting looking
      // like it worked in speaker view and silently failing in the gallery.
      await openMore(page)
      await page.getByRole('button', { name: 'Hide self view' }).tap()
      await closePanel(page)
      await expect
        .poll(surfaces, { timeout: 20_000, message: 'hidden means hidden in speaker view' })
        .toEqual({ card: 0, cells: 0 })
      await selectStageView(page, 'Gallery')
      await expect
        .poll(surfaces, { timeout: 20_000, message: '…and in the gallery, where the cell is' })
        .toEqual({ card: 0, cells: 0 })
    } finally {
      await Promise.all(peers.map((p) => p.context.close()))
    }
  })

  /**
   * Pinning YOURSELF shows you, not whoever is talking.
   *
   * Both stages asked `focusTrack(others, pinned)` with the local camera filtered
   * out. That filter is right for the automatic picks — being the loudest voice in
   * the room is no reason to full-bleed you to yourself — but it also meant a pin on
   * your own identity matched nothing and fell straight through to the active
   * speaker. `togglePin` switches the layout to speaker on the way, so asking to
   * watch yourself handed the whole screen to somebody else while your own tile
   * carried the "pinned" label. Measured, not guessed: Guest1 filled the stage.
   *
   * It was reachable before this branch — a desktop double-click, or a long-press on
   * the touch self-view card — but the gallery cell is what makes it the obvious
   * thing to try, because "double-tap a video to pin" is what the coachmark teaches
   * and your video is now one of the videos.
   */
  test('pinning your own gallery cell puts YOU on the stage', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = await Promise.all([
      newParticipant(browser, room, 'Guest1'),
      newParticipant(browser, room, 'Guest2'),
    ])
    try {
      await selectStageView(page, 'Gallery')
      const mine = page.getByRole('group', { name: /\(you\)/ })
      await expect(mine).toHaveCount(1, { timeout: 30_000 })

      // The taught gesture, on your own tile.
      await mine.dblclick()

      // The biggest tile on the stage is the one the pin asked for. Reading the
      // LARGEST tile rather than a specific locator is the point: the failure mode
      // is that some other tile is the big one, which an assertion aimed at your own
      // tile would sail straight past.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const groups = Array.from(
                document.querySelectorAll('[role="group"][aria-label]'),
              ) as HTMLElement[]
              const biggest = groups
                .filter((e) => e.offsetHeight > 60)
                .sort(
                  (x, y) =>
                    y.getBoundingClientRect().height * y.getBoundingClientRect().width -
                    x.getBoundingClientRect().height * x.getBoundingClientRect().width,
                )[0]
              return biggest?.getAttribute('aria-label') ?? null
            }),
          { timeout: 20_000, message: 'the pinned self is the big tile' },
        )
        .toMatch(/\(you\).*pinned/)
    } finally {
      await Promise.all(peers.map((p) => p.context.close()))
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
      await openMore(page)
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

    await openMore(page)
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
      await selectStageView(page, 'Gallery')
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

  /**
   * The on-screen keyboard must not cover the chat composer.
   *
   * `bottom-0` positions against the LAYOUT viewport, and the default
   * `interactive-widget=resizes-visual` means a software keyboard shrinks only the
   * VISUAL viewport — so the chat sheet stayed exactly where it was and the
   * keyboard was drawn over the field the user was typing into. Worst in
   * fullscreen, where there is no browser chrome to absorb any of it, which is how
   * it was reported.
   *
   * An emulated device cannot raise a keyboard, so the visual viewport is stubbed:
   * `__kb` is the number of px a keyboard would cover, and a resize on the REAL
   * visualViewport (which is what the hook listens to) drives the recompute. Same
   * class of seam as the forced safe-area inset above — without it the one case
   * this code exists for can never be exercised in a browser.
   */
  test('the chat composer stays above the on-screen keyboard', async ({ page }) => {
    await page.addInitScript(() => {
      const win = window as unknown as { __kb: number; __vv: VisualViewport }
      win.__kb = 0
      const real = window.visualViewport!
      win.__vv = real
      const fake = {
        get height() {
          return window.innerHeight - win.__kb
        },
        get offsetTop() {
          return 0
        },
        get scale() {
          return 1
        },
        addEventListener: real.addEventListener.bind(real),
        removeEventListener: real.removeEventListener.bind(real),
      }
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake })
    })

    const room = uniqueRoom()
    await join(page, room, 'Host')
    const composer = await openChat(page)
    await expect(composer).toBeVisible()

    const KB = 300
    await page.evaluate((kb) => {
      const win = window as unknown as { __kb: number; __vv: VisualViewport }
      win.__kb = kb
      win.__vv.dispatchEvent(new Event('resize'))
    }, KB)
    await page.waitForTimeout(400)

    const box = await page.evaluate(() => {
      const field = document.querySelector('textarea')!
      const sheet = field.closest('.fixed') as HTMLElement
      const f = field.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      return { fieldBottom: f.bottom, sheetTop: s.top, sheetBottom: s.bottom, vh: window.innerHeight }
    })

    // The keyboard's top edge. Everything you interact with has to be above it.
    const keyboardTop = box.vh - KB
    expect(box.sheetBottom, 'the sheet rests on the keyboard, not under it').toBeLessThanOrEqual(
      keyboardTop + 1,
    )
    expect(box.fieldBottom, 'the composer is not under the keyboard').toBeLessThanOrEqual(keyboardTop)
    // …and the sheet did not simply grow off the top of the screen to get there.
    expect(box.sheetTop, 'the sheet still starts on screen').toBeGreaterThanOrEqual(0)

    // Keyboard dismissed → the sheet settles back onto the bottom edge.
    await page.evaluate(() => {
      const win = window as unknown as { __kb: number; __vv: VisualViewport }
      win.__kb = 0
      win.__vv.dispatchEvent(new Event('resize'))
    })
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => {
      const sheet = document.querySelector('textarea')!.closest('.fixed') as HTMLElement
      return { bottom: sheet.getBoundingClientRect().bottom, vh: window.innerHeight }
    })
    expect(Math.round(after.vh - after.bottom), 'sheet back on the bottom edge').toBeLessThanOrEqual(2)
  })

  /**
   * Background blur is a one-tap toggle on your own tile.
   *
   * It used to open a "lens carousel" above the control bar — a horizontal
   * scroller built for a gallery of effects that no longer exists (image
   * backgrounds were removed for repeatedly breaking the feed), so it had shrunk
   * to a two-item strip whose whole content is a subset of More → Backgrounds &
   * effects. Two taps became one, and an overlay layer, a mirrored store and a
   * chrome-hold rule went with it.
   *
   * Two things are asserted, and neither depends on blur actually rendering:
   *
   * 1. **The tap is wired.** Recorded with a MutationObserver rather than a
   *    polled `toHaveAttribute`, because on a browser that CANNOT build the
   *    processor `mode` returns to 'none' about 300ms later (by design — see
   *    useBackgroundBlur's degrade path) and a poll can miss the window. The
   *    observer sees every value the attribute ever held, so this is deterministic
   *    whether the processor builds or not. @livekit/track-processors fetches the
   *    MediaPipe WASM from a CDN, so a sandboxed or offline runner is firmly in
   *    the "cannot build" case; a developer machine is in the other one.
   *
   * 2. **There is only ONE processor.** After things settle, the tile's toggle and
   *    the Effects dialog under More must agree — whichever way this platform
   *    resolved. That is the invariant `BlurProvider` exists for, and the one a
   *    mirrored store (which is what the carousel used) would break.
   */
  test('the self-view tile toggles background blur, in step with the More menu', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    // A peer, because solo renders SoloStage — the floating self-view card (which
    // carries these controls) only exists once someone else is in the call.
    const peer = await newParticipant(browser, room, 'Guest1')
    try {
      const self = page.getByRole('group', { name: /^Your video/ })
      await expect(self).toBeVisible({ timeout: 45_000 })

      // The tile's tools need a PUBLISHED camera (`hasVideo`), which lands a beat
      // after the card itself — so wait for the control rather than the card.
      const blurOn = page.getByRole('button', { name: 'Blur my background' })
      await expect(blurOn).toBeVisible({ timeout: 30_000 })
      await expect(blurOn).toHaveAttribute('aria-pressed', 'false')

      // Watch the toggle before touching it (see (1) above). The label states the
      // action, so it changes with the state — this matches either one.
      await page.evaluate(() => {
        const isBlurToggle = (b: Element) =>
          /^(Blur my background|Turn off background blur)$/.test(b.getAttribute('aria-label') ?? '')
        const btn = Array.from(document.querySelectorAll('button')).find(isBlurToggle)
        if (!btn) throw new Error('blur toggle not found')
        const seen: (string | null)[] = [btn.getAttribute('aria-pressed')]
        ;(window as unknown as { __blurSeen: (string | null)[] }).__blurSeen = seen
        new MutationObserver(() => seen.push(btn.getAttribute('aria-pressed'))).observe(btn, {
          attributes: true,
          attributeFilter: ['aria-pressed'],
        })
      })

      await blurOn.tap()
      await page.waitForTimeout(2000) // past the processor build / degrade
      const seen = await page.evaluate(
        () => (window as unknown as { __blurSeen: (string | null)[] }).__blurSeen,
      )
      expect(seen, 'tapping the tile control armed blur').toContain('true')

      // (2) One processor: the tile and the More menu agree on the settled state.
      const tileOn = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).some(
          (b) =>
            /^(Blur my background|Turn off background blur)$/.test(b.getAttribute('aria-label') ?? '') &&
            b.getAttribute('aria-pressed') === 'true',
        ),
      )
      await openMore(page)
      await page.getByRole('button', { name: /Backgrounds & effects/ }).tap()
      await expect(page.getByRole('button', { name: 'Blur', exact: true })).toHaveAttribute(
        'aria-pressed',
        String(tileOn),
      )
      await expect(page.getByRole('button', { name: 'None', exact: true })).toHaveAttribute(
        'aria-pressed',
        String(!tileOn),
      )
      // The Effects surface is a Dialog, not a Sheet — its own "Close" button, not
      // closePanel's "Close panel". A modal dialog aria-hides the stage, so the
      // tile control below is unreachable until this is actually shut.
      await page.getByRole('button', { name: 'Close', exact: true }).tap()
      await expect(page.getByRole('dialog')).toBeHidden()

      // Whichever state it settled in, the tile still offers the other one — the
      // control never ends up stuck with no way back.
      await revealChrome(page)
      const label = tileOn ? 'Turn off background blur' : 'Blur my background'
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    } finally {
      await peer.context.close()
    }
  })

})
