import { test, expect, type Page } from '@playwright/test'
import {
  uniqueRoom, join, newParticipant, openChat, setColorScheme,
  pageMetrics, overlaps, throttleNetwork, appErrors, attachErrorSink,
} from './helpers'

/**
 * Visual + edge-case scenarios. Each shoots the host screen into audit/scenarios/
 * (uploaded as a CI artifact for review), asserts no UI overlaps, and records
 * health metrics. These are the runs that surface "how do elements interact when
 * the room fills / the panel opens / the name is huge / the network drops".
 *
 * Participant counts stay <= 7 — past ~8 real headless Chromium saturate one
 * machine's CPU (a harness limit, not the product's; see E2E-FINDINGS). Real
 * scale lives in the lk load-test rig (npm run loadtest), not here.
 */
const SHOTS = 'audit/scenarios'
const shoot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })

test.describe('Visual scenarios @heavy', () => {
  test('solo → invite surface', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await expect(page.getByText(/only one here/i)).toBeVisible()
    await shoot(page, 'solo')
    expect(await overlaps(page)).toEqual([])
  })

  test('paged grid ramps cleanly 2→7', async ({ page, browser }) => {
    const sink = attachErrorSink(page)
    const room = uniqueRoom()
    await join(page, room, 'Host')
    const peers = []
    const report: Record<string, unknown>[] = []
    for (let n = 2; n <= 7; n++) {
      peers.push(await newParticipant(browser, room, `P${n}`))
      await page.waitForTimeout(1500) // let the tile subscribe + lay out
      const m = await pageMetrics(page)
      const ov = await overlaps(page)
      report.push({ participants: n, ...m, overlaps: ov.length })
      await shoot(page, `grid-${n}`)
      expect(ov, JSON.stringify(ov)).toEqual([]) // no UI collisions at any size
    }
    for (const p of peers) await p.context.close()
    test.info().attach('grid-metrics.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    expect(appErrors(sink)).toEqual([])
  })

  test('chat panel docks without covering controls (desktop)', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    await newParticipant(browser, room, 'Guest')
    await openChat(page)
    await shoot(page, 'chat-open-desktop')
    // The control bar must stay reachable while the panel is docked (the modal
    // regression). Mic toggle present + not overlapped.
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible()
    expect(await overlaps(page)).toEqual([])
  })

  test('long display name does not break tiles', async ({ page, browser }) => {
    const room = uniqueRoom()
    await join(page, room, 'Host')
    await newParticipant(browser, room, 'Maximilian-Alexander von Habsburg-Lothringen III')
    await page.waitForTimeout(1500)
    await shoot(page, 'long-name')
    expect(await overlaps(page)).toEqual([])
  })

  test('poor network surfaces a connection cue, recovers', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await throttleNetwork(page, '3g')
    await page.waitForTimeout(3000)
    await shoot(page, 'network-3g')
    await throttleNetwork(page, null)
    await page.waitForTimeout(2000)
    await shoot(page, 'network-restored')
    // Still in-call after recovery (didn't get dumped to prejoin).
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible()
  })
})

// In-call across both themes + key viewports → screenshots for review.
for (const scheme of ['light', 'dark'] as const) {
  test(`in-call snapshot · ${scheme} @heavy`, async ({ page, browser }) => {
    await setColorScheme(page, scheme)
    const room = uniqueRoom()
    await join(page, room, 'Host')
    await newParticipant(browser, room, 'Guest')
    await page.waitForTimeout(1500)
    for (const [w, h, label] of [[1440, 900, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'phone']] as const) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(500)
      await shoot(page, `incall-${scheme}-${label}`)
      expect(await overlaps(page), `${scheme}/${label}`).toEqual([])
    }
  })
}
