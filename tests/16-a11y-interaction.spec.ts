import { test, expect } from '@playwright/test'
import {
  closeContext,
  isTouch,
  join,
  newParticipant,
  revealChrome,
  uniqueRoom,
} from './helpers'

// 08-a11y runs the static axe sweep (contrast/ARIA/roles). The INTERACTION a11y
// added in the a11y pass — keyboard pin parity and the live-region announcer —
// is behaviour axe can't see (audit T7). These exercise it directly.
test.describe('A11y — interaction behaviours', () => {
  test('keyboard: focusing a tile and pressing Enter toggles pin', async ({ page }) => {
    test.skip(await isTouch(page), 'keyboard pin is a pointer-fine behaviour; phones have no keys')
    const room = uniqueRoom('kbpin')
    await join(page, room, 'Solo')

    // The self tile is a focusable group; its aria-label carries live state.
    const tile = page.getByRole('group', { name: /\(you\)/ }).first()
    await expect(tile).toBeVisible({ timeout: 20_000 })

    await tile.focus()
    await page.keyboard.press('Enter')
    await expect(tile).toHaveAttribute('aria-label', /pinned/, { timeout: 10_000 })

    // Enter again unpins.
    await page.keyboard.press('Enter')
    await expect(tile).not.toHaveAttribute('aria-label', /pinned/, { timeout: 10_000 })
  })

  test('announcer: muting the mic updates the polite live region', async ({ page }) => {
    const room = uniqueRoom('announce')
    await join(page, room, 'Speaker')

    // Several elements use role=status (toasts, effects) — target the announcer's
    // own sr-only polite region precisely.
    const polite = page.locator('div.sr-only[aria-live="polite"][role="status"]')
    await revealChrome(page)
    await page.getByRole('button', { name: /microphone/i }).first().click()
    await expect(polite).toContainText(/Microphone muted/i, { timeout: 10_000 })

    await revealChrome(page)
    await page.getByRole('button', { name: /microphone/i }).first().click()
    await expect(polite).toContainText(/Microphone on/i, { timeout: 10_000 })
  })

  test('announcer: a host force-mute is announced assertively to the target', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom('hostmute')
    await join(page, room, 'Host')
    const guest = await newParticipant(browser, room, 'Target')
    try {
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })
      // Host force-mutes the guest's tile (hover reveals the control).
      const muteBtn = page.getByRole('button', { name: /^Mute Target/ })
      await page.getByText('Target', { exact: false }).first().hover().catch(() => {})
      await expect(muteBtn).toBeVisible({ timeout: 15_000 })
      await muteBtn.click()

      // The target hears it via the ASSERTIVE channel (role=alert), not polite —
      // a host action on your mic must interrupt.
      const alert = guest.page.locator('div.sr-only[aria-live="assertive"][role="alert"]')
      await expect(alert).toContainText(/You were muted by the host/i, { timeout: 15_000 })
    } finally {
      await closeContext(guest.context)
    }
  })
})
