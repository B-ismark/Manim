import { test, expect } from '@playwright/test'
import { closeContext, join, newParticipant, uniqueRoom } from './helpers'

/**
 * Losing the network is said honestly (ConnectionBanner, RoomRoute's
 * Reconnecting screen): "Reconnecting… 0:12" with a way out, then, if LiveKit
 * gives up, a screen that keeps trying by itself and gets you back into the same
 * call when the network returns, instead of dumping you on the end-of-call page.
 *
 * `setOffline` cuts the signal connection, which is what a tunnel or a dead
 * Wi-Fi does; LiveKit spends about a minute retrying before it gives up.
 */
test.describe('Reconnecting', () => {
  test('a dropped network gets a ticking banner, then a screen that brings you back', async ({ page, browser }) => {
    test.setTimeout(240_000)
    const room = uniqueRoom('recon')
    await join(page, room, 'Kofi')
    const peer = await newParticipant(browser, room, 'Ama')
    try {
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeAttached({ timeout: 30_000 })
      await page.context().setOffline(true)

      const banner = page.getByText(/^Reconnecting… \d+:\d\d$/)
      await expect(banner).toBeVisible({ timeout: 45_000 })
      await expect(page.getByText('You’re offline. Check Wi-Fi or mobile data.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Leave', exact: true })).toBeVisible()

      // LiveKit gives up: not the end page, the Reconnecting screen.
      await expect(page.getByRole('button', { name: 'Keep trying' })).toBeVisible({ timeout: 150_000 })
      await expect(page.getByText('You were disconnected')).toHaveCount(0)

      await page.context().setOffline(false)
      await expect(page.getByRole('region', { name: 'Call controls' })).toBeAttached({ timeout: 60_000 })
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeAttached({ timeout: 30_000 })
      await expect(banner).toHaveCount(0)
    } finally {
      await page.context().setOffline(false)
      await closeContext(peer.context)
    }
  })

  test('Leave on the Reconnecting screen ends the call properly', async ({ page }) => {
    test.setTimeout(240_000)
    const room = uniqueRoom('recon-leave')
    await join(page, room, 'Kofi')
    await page.context().setOffline(true)
    await expect(page.getByRole('button', { name: 'Keep trying' })).toBeVisible({ timeout: 180_000 })
    await page.getByRole('button', { name: 'Leave', exact: true }).click()
    await page.context().setOffline(false)
    await expect(page.getByRole('heading', { name: 'You were disconnected' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rejoin' })).toBeVisible()
  })
})
