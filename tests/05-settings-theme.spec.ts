import { test, expect } from '@playwright/test'

test.describe('Settings + theme', () => {
  test('theme mode + accent + toggles work from the landing settings popover', async ({ page }) => {
    await page.goto('/')
    // Landing settings is an anchored popover (no scrim), like Setup + Contacts.
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText('Your profile, notifications, and appearance.')).toBeVisible()

    // Appearance mode segment.
    const dark = page.getByRole('button', { name: 'Dark' })
    await dark.click()
    await expect(dark).toHaveAttribute('aria-pressed', 'true')
    const light = page.getByRole('button', { name: 'Light' })
    await light.click()
    await expect(light).toHaveAttribute('aria-pressed', 'true')
    await expect(dark).toHaveAttribute('aria-pressed', 'false')

    // UI sounds toggle is present and switchable.
    const sounds = page.getByRole('switch', { name: 'UI sounds' })
    await expect(sounds).toBeVisible()
    const before = await sounds.getAttribute('aria-checked')
    await sounds.click()
    await expect(sounds).not.toHaveAttribute('aria-checked', before ?? '')

    // High-contrast toggle and at least one accent swatch (aria-pressed buttons).
    await expect(page.getByRole('switch', { name: 'High contrast' })).toBeVisible()
    await expect(page.locator('button[aria-pressed]').first()).toBeVisible()
  })

  test('Custom tab exposes token cards and reset', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Custom' }).click()
    await expect(page.getByText('System navigation')).toBeVisible()
    await expect(page.getByText('Selected items')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset to preset' })).toBeVisible()
  })
})
