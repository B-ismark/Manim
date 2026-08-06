import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import {
  uniqueRoom,
  join,
  revealChrome,
  fakeScreenShare,
  startScreenShare,
  inkBoundsUnit,
  isTouch,
  axeViolations,
  setColorScheme,
} from './helpers'

/**
 * The author palette must actually SHIP. This is not paranoia: the tokens
 * originally lived in @theme, and Tailwind v4 tree-shakes theme variables that
 * no generated utility references. Nothing emits a `bg-annotate-3` class — they
 * are read programmatically by the canvas — so seven of the eight were silently
 * dropped from the build and every author after the first fell back to one
 * shared colour, destroying the attribution the palette exists to provide.
 *
 * Deliberately outside the describe below so it runs even with the feature dark:
 * the CSS ships either way, and this is the check that catches the regression.
 */
test('the annotation author palette resolves and is distinct', async ({ page }) => {
  await page.goto('/')
  const vals = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const out: Record<string, string> = {}
    for (let i = 1; i <= 8; i++) out[`--annotate-${i}`] = cs.getPropertyValue(`--annotate-${i}`).trim()
    return out
  })
  const missing = Object.entries(vals).filter(([, v]) => !v).map(([k]) => k)
  expect(missing, 'every palette token must survive the CSS build').toEqual([])
  expect(new Set(Object.values(vals)).size, 'all eight authors must differ').toBe(8)
})

/**
 * Screen-share annotation across participants.
 *
 * The guarantee under test is the one nothing else can check: a stroke drawn by
 * one person must land on the SAME CONTENT PIXEL for everyone else, even though
 * every participant sees the share at a different size and with different
 * letterbox bars. The unit tests cover the maths in isolation; only a real room
 * proves the whole chain — pointer → normalise → wire → data channel → decode →
 * denormalise → paint — agrees end to end.
 *
 * NOTE ON SHAPE: in most tests below the sharer is a separate participant, because a
 * REMOTE share is what takes the big region when both are present. The presenter's own
 * share is on their stage from the moment they share — covered by its own test below.
 *
 * The two viewers below have deliberately different viewport SHAPES, not just
 * sizes, so their letterbox insets differ. If strokes were normalised against the
 * container rather than the video's content box, this test fails.
 *
 * Requires a screen share, which
 * headless Chromium can't source for real — `fakeScreenShare` substitutes a
 * canvas capture of known intrinsic size.
 */

const SHARE_W = 1280
const SHARE_H = 720
const SHARE_ASPECT = SHARE_W / SHARE_H

/**
 * Desktop context options. `browser.newContext()` inherits the running PROJECT's
 * device, so under the mobile projects an auxiliary participant would also be a
 * touch device — where screen share lives in the More sheet and the pen doesn't
 * exist at all. These fixtures are incidental to what's under test, so they are
 * pinned to a mouse-driven desktop regardless of project.
 */
const DESKTOP = {
  permissions: ['camera', 'microphone'] as const,
  viewport: { width: 1280, height: 800 },
  hasTouch: false,
  isMobile: false,
  deviceScaleFactor: 1,
}

/** A participant who publishes a synthetic screen share of known dimensions. */
async function addSharer(
  browser: import('@playwright/test').Browser,
  room: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
  const page = await context.newPage()
  await fakeScreenShare(page, SHARE_W, SHARE_H)
  await join(page, room, 'Presenter')
  await startScreenShare(page)
  return { context, page }
}

/** Content-box geometry of a viewer's annotation canvas, in page coordinates. */
async function canvasGeometry(page: Page) {
  return page.evaluate((a) => {
    const el = document.querySelector('[data-testid="annotation-canvas"]') as HTMLCanvasElement
    const r = el.getBoundingClientRect()
    const boxAspect = r.width / r.height
    let cw = r.width, ch = r.height, cx = 0, cy = 0
    if (a > boxAspect) { ch = r.width / a; cy = (r.height - ch) / 2 }
    else { cw = r.height * a; cx = (r.width - cw) / 2 }
    return { left: r.left, top: r.top, cx, cy, cw, ch }
  }, SHARE_ASPECT)
}

/** Arm the pen and drag a horizontal stroke between two unit-space x positions. */
async function drawStroke(page: Page, ux0: number, ux1: number, uy: number) {
  await revealChrome(page)
  await page.getByRole('button', { name: /Annotate shared screen/i }).click()
  // The canvas can still be mounting (a share that has only just started), so wait
  // rather than querying into a null.
  await page.getByTestId('annotation-canvas').waitFor({ state: 'visible', timeout: 20_000 })
  const g = await canvasGeometry(page)
  const at = (ux: number) => ({ x: g.left + g.cx + ux * g.cw, y: g.top + g.cy + uy * g.ch })
  const start = at(ux0)
  const end = at(ux1)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(start.x + ((end.x - start.x) * i) / 8, start.y)
  }
  await page.mouse.up()
}

test.describe('Annotation over a shared screen @annotate', () => {
  // The feature ships dark behind a build flag, so the overlay simply isn't in the
  // bundle unless it's on. Skip rather than fail when it's off, matching how the
  // stress/loadtest specs gate themselves.
  test.skip(
    process.env.VITE_ANNOTATE === 'false',
    'annotation is disabled (VITE_ANNOTATE=false)',
  )

  test('a stroke lands at the same content position for a viewer on a different viewport', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'drawing is desktop-only; the touch case is covered below')
    const room = uniqueRoom('annot')

    const sharer = await addSharer(browser, room)

    // Viewer A — the default 1280x800 viewport — will draw.
    await join(page, room, 'Ada')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    // Viewer B — a very different viewport shape, so different letterboxing.
    const ctxB = await browser.newContext({
      ...DESKTOP,
      permissions: [...DESKTOP.permissions],
      viewport: { width: 900, height: 760 },
    })
    const viewerB = await ctxB.newPage()
    await join(viewerB, room, 'Bo')
    await expect(viewerB.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    await drawStroke(page, 0.3, 0.7, 0.5)

    // Let the packet cross the data channel and both sides paint. Kept short —
    // strokes start fading a couple of seconds after their last point.
    await page.waitForTimeout(400)

    const [inkA, inkB] = await Promise.all([
      inkBoundsUnit(page, SHARE_ASPECT),
      inkBoundsUnit(viewerB, SHARE_ASPECT),
    ])

    expect(inkA, 'the author sees their own ink').not.toBeNull()
    expect(inkB, 'the other viewer received and rendered the stroke').not.toBeNull()

    // The author's ink sits where we aimed.
    expect(inkA!.x0).toBeCloseTo(0.3, 1)
    expect(inkA!.x1).toBeCloseTo(0.7, 1)
    expect(inkA!.y0).toBeCloseTo(0.5, 1)

    // THE ASSERTION THAT MATTERS: both viewers agree in unit space despite
    // different viewport shapes and different letterbox insets.
    expect(inkB!.x0).toBeCloseTo(inkA!.x0, 1)
    expect(inkB!.x1).toBeCloseTo(inkA!.x1, 1)
    expect(inkB!.y0).toBeCloseTo(inkA!.y0, 1)
    expect(inkB!.y1).toBeCloseTo(inkA!.y1, 1)

    await ctxB.close()
    await sharer.context.close()
  })

  test('touch devices see strokes but cannot draw', async ({ page, browser }) => {
    test.setTimeout(150_000)
    test.skip(!(await isTouch(page)), 'touch-only check')

    const room = uniqueRoom('annot')
    const sharer = await addSharer(browser, room)

    // A desktop viewer who will draw.
    const deskCtx = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
    const desktop = await deskCtx.newPage()
    await join(desktop, room, 'Ada')
    await expect(desktop.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    // The touch viewer.
    await join(page, room, 'Mo')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    // No draw affordance on touch: drawing would have to capture touch, which
    // collides with the control bar's tap-to-reveal.
    await revealChrome(page)
    await expect(page.getByRole('button', { name: /Annotate shared screen/i })).toHaveCount(0)

    // ...but a remote stroke still renders, so the phone isn't cut out of the
    // conversation — view-only, not blind.
    await drawStroke(desktop, 0.3, 0.7, 0.5)
    await desktop.waitForTimeout(500)
    expect(await inkBoundsUnit(page, SHARE_ASPECT), 'touch viewer renders remote ink').not.toBeNull()

    // The control bar must still respond — the overlay must not be swallowing taps.
    await revealChrome(page)
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible()

    await deskCtx.close()
    await sharer.context.close()
  })

  test('no page scroll is introduced on a short phone', async ({ page, browser }) => {
    test.setTimeout(150_000)
    test.skip(!(await isTouch(page)), 'touch-only check')
    const room = uniqueRoom('annot')
    const sharer = await addSharer(browser, room)
    await join(page, room, 'Mo')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }))
    expect(overflow.x, 'no horizontal page scroll').toBeLessThanOrEqual(1)
    expect(overflow.y, 'no vertical page scroll').toBeLessThanOrEqual(1)

    await sharer.context.close()
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`no accessibility violations with the pen armed (${scheme})`, async ({ page, browser }) => {
      test.setTimeout(150_000)
      test.skip(await isTouch(page), 'desktop-only: the pen cannot be armed on touch')
      await setColorScheme(page, scheme)
      const room = uniqueRoom('annot')
      const sharer = await addSharer(browser, room)
      await join(page, room, 'Ada')
      await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

      await revealChrome(page)
      await page.getByRole('button', { name: /Annotate shared screen/i }).click()
      expect(await axeViolations(page)).toEqual([])

      await sharer.context.close()
    })
  }

  test('a presenter sharing a WINDOW can draw on their own share, and only while the pen is armed', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'drawing is desktop-only')
    const room = uniqueRoom('annot')

    // THIS page is the presenter — the case every other test in this file routes
    // around. A browser tab cannot paint over the OS the way the Teams and Zoom
    // native apps do, so the only surface a presenter can draw on is their own
    // captured frame, which is why their own share is on their own stage.
    //
    // Explicitly a WINDOW share. That is the case where echoing your own capture
    // back to you is safe: a window cannot contain this call, so there is nothing to
    // recurse into. The monitor case is the opposite and is covered by the test
    // below — this one used to stand in for both, which is how the mirror shipped.
    await fakeScreenShare(page, SHARE_W, SHARE_H, 10, 'window')
    await join(page, room, 'Presenter')

    const ctxB = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
    const viewer = await ctxB.newPage()
    await join(viewer, room, 'Bo')

    await startScreenShare(page)
    await expect(viewer.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    // Sharing alone puts the presenter in the split view, pen not yet armed — they
    // should never have to discover annotation before they can see what they're
    // sending. The drawing surface is present and the button to arm it is ON it.
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Draw on the shared screen$/i })).toBeVisible()

    // Arming, drawing, and the viewer agreeing on where the ink is.
    await drawStroke(page, 0.3, 0.7, 0.5)
    await page.waitForTimeout(400)

    const [inkSelf, inkRemote] = await Promise.all([
      inkBoundsUnit(page, SHARE_ASPECT),
      inkBoundsUnit(viewer, SHARE_ASPECT),
    ])
    expect(inkSelf, 'the presenter sees their own ink').not.toBeNull()
    expect(inkRemote, 'the viewer received it').not.toBeNull()
    expect(inkSelf!.x0).toBeCloseTo(0.3, 1)
    expect(inkRemote!.x0).toBeCloseTo(inkSelf!.x0, 1)
    expect(inkRemote!.y0).toBeCloseTo(inkSelf!.y0, 1)

    // Disarming stops the PEN, not the view: the share stays on the presenter's
    // stage. Yanking a whole region away on disarm was the layout swap that made
    // annotating feel like it broke the call underneath you.
    await revealChrome(page)
    await page.getByRole('button', { name: /^Stop annotating$/i }).click()
    await expect(page.getByTestId('annotation-canvas')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Draw on the shared screen$/i })).toBeVisible()

    await ctxB.close()
  })

  /**
   * Sharing a WHOLE MONITOR is the case the self-echo cannot serve.
   *
   * The monitor contains this window, so echoing the capture back onto the stage
   * recurses into a mirror tunnel — and re-captures the presenter's own cursor, which
   * is why arming the pen used to put two crosshairs on screen. `displaySurface` says
   * which case you are in; nothing read it, so both symptoms shipped.
   *
   * The default is therefore no echo. But it is a default, not a rule: someone who
   * genuinely wants to see (or annotate) their full screen can say so, and the pill
   * carries that switch. Both halves are asserted here, because the escape hatch is
   * also what makes 'unknown' safe to treat permissively on browsers that report no
   * surface type at all.
   */
  test('sharing an entire screen does not echo it back, until the presenter asks', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'the presenting pill control is desktop-only')
    const room = uniqueRoom('annot')

    await fakeScreenShare(page, SHARE_W, SHARE_H, 10, 'monitor')
    await join(page, room, 'Presenter')

    const ctxB = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
    const viewer = await ctxB.newPage()
    await join(viewer, room, 'Bo')

    await startScreenShare(page)

    // The viewer is unaffected — they are not inside the loop, so they see the share
    // exactly as before. This is the assertion that stops a fix for the presenter
    // from quietly costing everyone else the thing being shared.
    await expect(viewer.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    await revealChrome(page)
    await expect(page.getByText(/You.re sharing your entire screen/)).toBeVisible({
      timeout: 30_000,
    })
    // No echo => no drawing surface on the presenter's own stage.
    await expect(page.getByTestId('annotation-canvas')).toHaveCount(0)

    // ...and the way back. One tap restores the echo, and with it the pen — the
    // presenter is never stuck with the app's inference.
    await page.getByRole('button', { name: /^Show my screen$/i }).click()
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Hide my screen$/i })).toBeVisible()

    await ctxB.close()
  })

  /**
   * A viewer's picture must survive somebody else annotating on it.
   *
   * Nothing else here checks this: every other test asserts where the INK lands,
   * which passes just as happily over a video that has gone black. The share is
   * the content; the ink is a layer on top of it, and a stroke arriving must not
   * cost the viewer the thing being drawn on — so this asserts the video element
   * is still there AND still decoding (currentTime advancing), not merely mounted.
   */
  test('a viewer keeps seeing the shared screen while the presenter draws on it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'drawing is desktop-only')
    const room = uniqueRoom('annot')

    await fakeScreenShare(page, SHARE_W, SHARE_H)
    await join(page, room, 'Presenter')

    const ctxB = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
    const viewer = await ctxB.newPage()
    await join(viewer, room, 'Bo')

    await startScreenShare(page)
    await expect(viewer.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    /** The share as the viewer sees it: its size, and how far it has played. */
    const shareState = (p: Page) =>
      p.evaluate(
        ([w, h]) => {
          const v = Array.from(document.querySelectorAll('video')).find(
            (el) => el.videoWidth === w && el.videoHeight === h,
          )
          return v ? { t: v.currentTime, paused: v.paused, ready: v.readyState } : null
        },
        [SHARE_W, SHARE_H],
      )

    await viewer.waitForTimeout(1500)
    const before = await shareState(viewer)
    expect(before, 'the viewer has the share before any ink').not.toBeNull()

    await drawStroke(page, 0.3, 0.7, 0.5)
    await viewer.waitForTimeout(2000)

    const after = await shareState(viewer)
    expect(after, 'the share survives the first stroke').not.toBeNull()
    expect(after!.paused, 'and is still playing').toBe(false)
    expect(after!.t, 'and is still decoding new frames').toBeGreaterThan(before!.t)

    await ctxB.close()
  })

  test('a remote share still wins over your own while annotating', async ({ page, browser }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'drawing is desktop-only')
    const room = uniqueRoom('annot')

    // Someone else is presenting AND so are you. Arming the pen must keep pointing at
    // THEIR screen — the thing under discussion — not silently swap the stage to yours.
    const sharer = await addSharer(browser, room)

    await fakeScreenShare(page, 640, 480) // a deliberately different aspect
    await join(page, room, 'Ada')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })
    await startScreenShare(page)

    await revealChrome(page)
    await page.getByRole('button', { name: /Annotate shared screen/i }).click()

    // The big tile is still the remote 1280x720 share, so the canvas still matches it.
    await page.waitForTimeout(1500)
    const aspect = await page.evaluate(() => {
      // The big region is by definition the largest rendered video.
      const v = Array.from(document.querySelectorAll('video'))
        .filter((el) => el.videoWidth > 0)
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
      return v ? v.videoWidth / v.videoHeight : 0
    })
    expect(aspect, 'the remote share keeps the big region').toBeCloseTo(SHARE_ASPECT, 1)

    await sharer.context.close()
  })

  test('strokes fade away on their own', async ({ page, browser }) => {
    test.setTimeout(150_000)
    test.skip(await isTouch(page), 'drawing is desktop-only')
    const room = uniqueRoom('annot')
    const sharer = await addSharer(browser, room)

    await join(page, room, 'Ada')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    await drawStroke(page, 0.35, 0.65, 0.5)
    await page.waitForTimeout(300)
    expect(await inkBoundsUnit(page, SHARE_ASPECT), 'ink is visible right after drawing').not.toBeNull()

    // HOLD_MS + FADE_MS is 4s; allow margin.
    await page.waitForTimeout(6000)
    expect(await inkBoundsUnit(page, SHARE_ASPECT), 'ink has faded to nothing').toBeNull()

    await sharer.context.close()
  })
})
