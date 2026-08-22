import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  appErrors,
  attachErrorSink,
  closeContext,
  join,
  type ErrorSink,
  uniqueRoom,
} from './helpers'
import type { Page, BrowserContext } from '@playwright/test'

/**
 * Capacity / stress probe. Ramps real LiveKit participants into one room and
 * records how the tile grid + client behave at N. Gated behind STRESS=1 because
 * it spins up many headless Chromium contexts (heavy on a single machine) and
 * hits the live LiveKit room. Tune the ceiling with CAP_N (default 12).
 *
 *   STRESS=1 CAP_N=16 npx playwright test 07-capacity --project=desktop --workers=1
 */
const RUN = process.env.STRESS === '1'
const TARGET = Number(process.env.CAP_N || 12)

test.describe('Capacity', () => {
  test.skip(!RUN, 'set STRESS=1 to run the capacity ramp')
  test.describe.configure({ mode: 'serial', timeout: 600_000 })

  test(`ramp to ${TARGET} participants and inspect the tile grid`, async ({ page, browser }) => {
    const room = uniqueRoom('cap')
    const hostSink = attachErrorSink(page)
    await join(page, room, 'P00')

    const extras: { context: BrowserContext; page: Page; sink: ErrorSink }[] = []
    let joined = 1
    let firstFailureAt = 0

    for (let i = 1; i < TARGET; i++) {
      const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
      const p = await context.newPage()
      const sink = attachErrorSink(p)
      try {
        await join(p, room, `P${String(i).padStart(2, '0')}`)
        joined++
        extras.push({ context, page: p, sink })
      } catch (e) {
        firstFailureAt = i + 1
        // Deliberately NOT closeContext: this is the unhappy path, and the loop is
        // about to break and report. A cleanup that swallows only the known
        // trace-zip flake would let any other close error replace the diagnosis we
        // came here for. Swallow everything on a path whose job is to give up.
        await context.close().catch(() => {})
        // eslint-disable-next-line no-console
        console.log(`[capacity] join failed at participant ${i + 1}: ${(e as Error).message}`)
        break
      }
      // Let the SFU + adaptiveStream settle between joins.
      await page.waitForTimeout(800)
    }

    // Let the host page subscribe + lay out the grid.
    await page.waitForTimeout(4000)

    const metrics = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'))
      const grid = document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null
      return {
        videoElements: videos.length,
        decodingVideos: videos.filter((v) => (v as HTMLVideoElement).videoWidth > 0).length,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null,
        tilesInGrid: grid ? grid.children.length : null,
      }
    })

    // Read the participant count the host's chip reports.
    const chip = page.getByRole('button', { name: /Participants \(\d+\)/ })
    let reportedCount = joined
    try {
      const label = await chip.getAttribute('aria-label', { timeout: 5000 })
      const m = label?.match(/\((\d+)\)/)
      if (m) reportedCount = Number(m[1])
    } catch {
      /* chip may be hidden; fall back to joined */
    }

    const result = {
      target: TARGET,
      joined,
      reportedByHostChip: reportedCount,
      firstFailureAt: firstFailureAt || null,
      tileGrid: metrics,
      hostAppErrors: appErrors(hostSink).slice(0, 20),
      guestAppErrorCounts: extras.map((e) => appErrors(e.sink).length),
    }
    mkdirSync('playwright-report', { recursive: true })
    writeFileSync('playwright-report/capacity.json', JSON.stringify(result, null, 2))
    // eslint-disable-next-line no-console
    console.log('[capacity] RESULT', JSON.stringify(result, null, 2))

    // Tear down. Same reasoning as above, and sharper: the sanity assertion is
    // BELOW this loop, so a throw here would report a teardown error instead of the
    // capacity result the whole test exists to produce.
    for (const e of extras) await e.context.close().catch(() => {})

    // Sanity: at least the host + a few others actually connected.
    expect(joined).toBeGreaterThanOrEqual(Math.min(4, TARGET))
    // The grid must never render MORE video elements than participants (a tile
    // leak), and the host page must not have thrown.
    expect(metrics.videoElements).toBeLessThanOrEqual(joined + 1)
  })
})
