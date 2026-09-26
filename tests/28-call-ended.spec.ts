import { test, expect } from '@playwright/test'
import { activate, closeContext, isTouch, join, newParticipant, pressChrome, uniqueRoom } from './helpers'

/**
 * The end-of-call page (RoomRoute's CallEnded) after a real call: Copy link sits
 * beside Rejoin and puts the invite (secrets and all) on the clipboard, and a
 * one-tap "How was the call?" takes a thumbs down through one optional follow-up
 * to a thank-you. Under 30s in, there is no rating: nothing to rate yet.
 */
test.describe('Call ended', () => {
  test('after a real call: Copy link and a one-tap rating', async ({ page, browser, context }, info) => {
    test.setTimeout(120_000)
    const room = uniqueRoom('ended')
    await join(page, room, 'Kofi')
    const peer = await newParticipant(browser, room, 'Ama')
    try {
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeAttached({ timeout: 30_000 })
      // The rating and the time chip both wait for 30 seconds in the call.
      await page.waitForTimeout(31_000)
      const left = page.getByRole('heading', { name: 'You left the call' })
      await pressChrome(page, page.getByRole('button', { name: 'Leave call' }), left)

      await expect(page.getByText('Under a minute')).toBeVisible()
      await expect(page.getByText('How was the call?')).toBeVisible()
      // No page scroll, even on the short phone.
      const overflow = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      expect(overflow).toBeLessThanOrEqual(1)
      await page.screenshot({ path: `test-results/shots/28-ended-${info.project.name}.png` })

      const copy = page.getByRole('button', { name: 'Copy link' })
      await expect(copy).toBeVisible()
      if (!(await isTouch(page))) {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await copy.click()
        await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
        const text = await page.evaluate(() => navigator.clipboard.readText())
        expect(text).toContain(`/r/${room}`)
      }

      await activate(page, page.getByRole('button', { name: 'Not great' }))
      await expect(page.getByText('Sorry about that. What went wrong?')).toBeVisible()
      await page.screenshot({ path: `test-results/shots/28-ended-issue-${info.project.name}.png` })
      // The taller follow-up still fits without scrolling.
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1)
      await activate(page, page.getByRole('button', { name: 'Connection' }))
      await expect(page.getByText('Thanks, that helps.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Rejoin' })).toBeVisible()
    } finally {
      await closeContext(peer.context)
    }
  })

  test('a quick in-and-out gets no rating', async ({ page }) => {
    const room = uniqueRoom('ended-quick')
    await join(page, room, 'Kofi')
    const left = page.getByRole('heading', { name: 'You left the call' })
    await pressChrome(page, page.getByRole('button', { name: 'Leave call' }), left)
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(page.getByText('How was the call?')).toHaveCount(0)
  })
})
