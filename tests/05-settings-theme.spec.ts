import { test, expect } from '@playwright/test'

test.describe('Settings + theme', () => {
  test('theme mode + accent + toggles work from the landing settings dialog', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()

    // Appearance mode segment.
    const dark = dialog.getByRole('button', { name: 'Dark' })
    await dark.click()
    await expect(dark).toHaveAttribute('aria-pressed', 'true')
    const light = dialog.getByRole('button', { name: 'Light' })
    await light.click()
    await expect(light).toHaveAttribute('aria-pressed', 'true')
    await expect(dark).toHaveAttribute('aria-pressed', 'false')

    // UI sounds toggle is present and switchable.
    const sounds = dialog.getByRole('switch', { name: 'UI sounds' })
    await expect(sounds).toBeVisible()
    const before = await sounds.getAttribute('aria-checked')
    await sounds.click()
    await expect(sounds).not.toHaveAttribute('aria-checked', before ?? '')

    // High-contrast toggle and at least one accent swatch (aria-pressed buttons).
    await expect(dialog.getByRole('switch', { name: 'High contrast' })).toBeVisible()
    await expect(dialog.locator('button[aria-pressed]').first()).toBeVisible()
  })

  test('Custom tab exposes token cards and reset', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Custom' }).click()
    await expect(dialog.getByText('System navigation')).toBeVisible()
    await expect(dialog.getByText('Selected items')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Reset to preset' })).toBeVisible()
  })
})
