import { test, expect } from '@playwright/test'
import { attachErrorSink, appErrors } from './helpers'

test.describe('Landing', () => {
  test('renders and Join is gated on a room name', async ({ page }) => {
    const sink = attachErrorSink(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
    const join = page.getByRole('button', { name: 'Join' })
    await expect(join).toBeDisabled()
    await page.locator('#room').fill('my-room')
    await expect(join).toBeEnabled()
    expect(appErrors(sink)).toEqual([])
  })

  test('Join navigates to a slugified room route', async ({ page }) => {
    await page.goto('/')
    await page.locator('#room').fill('Team Standup')
    await page.getByRole('button', { name: 'Join' }).click()
    await expect(page).toHaveURL(/\/r\/team-standup$/)
    // Lands on prejoin.
    await expect(page.getByLabel('Your name')).toBeVisible({ timeout: 20_000 })
  })

  test('New meeting generates a random, secured room when no name is typed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New meeting' }).click()
    // High-entropy slug PLUS a join secret + E2EE key in the #fragment (the link,
    // not the slug, is the credential — see lib/roomLink).
    await expect(page).toHaveURL(/\/r\/[a-z]+-[a-z]+-[a-z0-9]+#k=[^&]+&e=.+$/)
  })

  test('New meeting uses a typed name and still mints link secrets', async ({ page }) => {
    await page.goto('/')
    await page.locator('#room').fill('Design Sync')
    await page.getByRole('button', { name: 'New meeting' }).click()
    await expect(page).toHaveURL(/\/r\/design-sync#k=[^&]+&e=.+$/)
  })

  test('Settings popover opens from landing', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    // Settings is an anchored popover (no scrim), not a modal dialog.
    await expect(page.getByText('Your profile, notifications, and appearance.')).toBeVisible()
  })

  test('unknown route redirects home', async ({ page }) => {
    await page.goto('/totally/unknown/path')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
  })
})
