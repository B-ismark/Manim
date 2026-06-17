import { test, expect } from '@playwright/test'
import { join, uniqueRoom, attachErrorSink, appErrors, revealChrome } from './helpers'

// TEMP: People panel renders after QR removal (Copy link stays, no QR). Delete after.
test('people panel: invite row intact, QR gone', async ({ page }) => {
  const sink = attachErrorSink(page)
  await join(page, uniqueRoom('qr'), 'Alice')
  await revealChrome(page)
  await page.getByRole('button', { name: 'Open chat' }).click()
  await page.getByRole('tab', { name: /People/i }).click()

  await expect(page.getByRole('button', { name: /Copy link/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Show QR code/i })).toHaveCount(0)
  expect(appErrors(sink)).toEqual([])
})
