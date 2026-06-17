import { test, expect } from '@playwright/test'
import { join, pageMetrics, overlaps, attachErrorSink, appErrors } from './helpers'

/**
 * Observe the HOST UI while the room is flooded by `lk load-test` sim
 * participants (server-side, no browsers) — the only way to see the in-call UI
 * under real scale (20/50/100) past the headless-Chromium ceiling.
 *
 * Skips unless LOADTEST_ROOM is set. Flow:
 *   1. scripts/load-test.sh ROOM=stress-1 PUBLISHERS=20 ... &   (fills the room)
 *   2. LOADTEST_ROOM=stress-1 npx playwright test 10-loadtest-observe --project=desktop
 * The host joins the same LiveKit room, so the app subscribes to all sim tiles.
 */
const ROOM = process.env.LOADTEST_ROOM

test.describe('Load-test observe @heavy', () => {
  test.skip(!ROOM, 'set LOADTEST_ROOM (and run scripts/load-test.sh against it first)')

  test('host UI survives a flooded room', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, ROOM as string, 'Observer')
    // Let the SFU push subscriptions + the paged grid settle.
    await page.waitForTimeout(8000)

    const m = await pageMetrics(page)
    const ov = await overlaps(page)
    test.info().attach('loadtest-metrics.json', {
      body: JSON.stringify({ room: ROOM, ...m, overlaps: ov.length }, null, 2),
      contentType: 'application/json',
    })
    await page.screenshot({ path: `audit/scenarios/loadtest-${ROOM}.png` })

    // The host must stay in-call and uncluttered no matter the headcount.
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible()
    expect(ov, JSON.stringify(ov)).toEqual([])
    // No hard crash errors (transient negotiation noise is filtered in appErrors).
    expect(appErrors(sink)).toEqual([])
  })
})
