import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import {
  uniqueRoom,
  join,
  revealChrome,
  fakeScreenShare,
  startScreenShare,
  inkBoundsUnit,
} from './helpers'

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
 * NOTE ON SHAPE: the sharer is always a separate participant. Stage deliberately
 * excludes your OWN share from the presentation layout ("you're already looking
 * at your screen"), so the annotation overlay only exists for viewers. Annotating
 * your own share is therefore not possible today.
 *
 * The two viewers below have deliberately different viewport SHAPES, not just
 * sizes, so their letterbox insets differ. If strokes were normalised against the
 * container rather than the video's content box, this test fails.
 *
 * Requires VITE_ANNOTATE=true (the feature ships dark) and a screen share, which
 * headless Chromium can't source for real — `fakeScreenShare` substitutes a
 * canvas capture of known intrinsic size.
 */

const SHARE_W = 1280
const SHARE_H = 720
const SHARE_ASPECT = SHARE_W / SHARE_H

/** A participant who publishes a synthetic screen share of known dimensions. */
async function addSharer(
  browser: import('@playwright/test').Browser,
  room: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
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
    process.env.VITE_ANNOTATE !== 'true',
    'annotation is off (set VITE_ANNOTATE=true on the dev server and this run)',
  )

  test('a stroke lands at the same content position for a viewer on a different viewport', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    const room = uniqueRoom('annot')

    const sharer = await addSharer(browser, room)

    // Viewer A — the default 1280x800 viewport — will draw.
    await join(page, room, 'Ada')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30_000 })

    // Viewer B — a very different viewport shape, so different letterboxing.
    const ctxB = await browser.newContext({
      permissions: ['camera', 'microphone'],
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

  test('strokes fade away on their own', async ({ page, browser }) => {
    test.setTimeout(150_000)
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
