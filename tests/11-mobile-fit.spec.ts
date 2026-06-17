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
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only')
  })

  const pageOverflow = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

  test('landing fits', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Start or join a call' })).toBeVisible()
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
