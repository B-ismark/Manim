import { test, expect } from '@playwright/test'
import { uniqueRoom, denyMedia } from './helpers'

// The most common first-run friction — the user blocks the camera/mic — was
// untested (audit T4); every other spec auto-grants media. denyMedia() forces a
// hard NotAllowedError from getUserMedia (overriding the fake-media flag) so we
// hit PreJoin's denied path. canJoin is gated only by the name, so a blocked user
// must still be able to join view/audio-only.
test.describe('Permissions — camera/mic denied', () => {
  test('denied media shows guidance but still lets the user join', async ({ page }) => {
    await denyMedia(page)
    const room = uniqueRoom('perm')
    await page.goto(`/r/${room}`, { waitUntil: 'domcontentloaded' })

    const nameInput = page.getByLabel('Your name')
    await expect(nameInput).toBeVisible({ timeout: 20_000 })

    // The preview acquisition fails → the app surfaces guidance rather than dying.
    await expect(page.getByText(/permission denied or unavailable|blocked/i)).toBeVisible({
      timeout: 15_000,
    })

    // Join is NOT gated by the denied permission — only by a non-empty name.
    await nameInput.fill('NoMedia')
    const joinBtn = page.getByRole('button', { name: 'Join now' })
    await expect(joinBtn).toBeEnabled()
    await joinBtn.click()

    // The app honours the join and leaves prejoin (no media required to connect).
    await expect(nameInput).toBeHidden({ timeout: 45_000 })
  })
})
