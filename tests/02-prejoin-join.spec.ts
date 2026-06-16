import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join } from './helpers'

test.describe('PreJoin + join', () => {
  test('Join now is gated on a name; device toggles flip labels', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    const joinBtn = page.getByRole('button', { name: 'Join now' })
    await expect(joinBtn).toBeVisible({ timeout: 20_000 })
    await expect(joinBtn).toBeDisabled()

    // Mic/cam toggle accessible-name flips.
    const mic = page.getByRole('button', { name: 'Mute microphone' })
    await expect(mic).toBeVisible()
    await mic.click()
    await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()

    const cam = page.getByRole('button', { name: 'Turn off camera' })
    await cam.click()
    await expect(page.getByRole('button', { name: 'Turn on camera' })).toBeVisible()

    await page.getByLabel('Your name').fill('Ada')
    await expect(joinBtn).toBeEnabled()
  })

  test('low-bandwidth disables the camera toggle', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('switch', { name: /Low-bandwidth/i }).click()
    await expect(page.getByRole('button', { name: /camera/i })).toBeDisabled()
    await expect(page.getByText('Audio-only / low bandwidth')).toBeVisible()
  })

  test('full join → in-call → leave returns home', async ({ page }) => {
    const sink = attachErrorSink(page)
    const room = uniqueRoom()
    await join(page, room, 'Ada')
    // In-call chrome present.
    await expect(page.getByRole('button', { name: 'Open chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible()
    await page.getByRole('button', { name: 'Leave call' }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
    expect(appErrors(sink), `unexpected app errors: ${appErrors(sink).join('\n')}`).toEqual([])
  })

  test('Enter key in the name field joins', async ({ page }) => {
    const room = uniqueRoom()
    await page.goto(`/r/${room}`)
    const name = page.getByLabel('Your name')
    await expect(name).toBeVisible({ timeout: 20_000 })
    await name.fill('Grace')
    await name.press('Enter')
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible({
      timeout: 45_000,
    })
  })
})
