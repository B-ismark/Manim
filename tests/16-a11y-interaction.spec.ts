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

  test('keyboard: closing a panel puts focus back on the control that opened it', async ({ page }) => {
    test.skip(await isTouch(page), 'keyboard focus return is a pointer-fine behaviour')
    const room = uniqueRoom('kbfocus')
    await join(page, room, 'Solo')

    // Radix only restores focus to its own Trigger, which the app never uses, so
    // closing used to drop focus on <body> (the top of the page for a keyboard user).
    const chat = page.getByRole('button', { name: /^Open chat/ })
    await chat.focus()
    await page.keyboard.press('Enter')
    const composer = page.getByRole('combobox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(chat).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    await expect(composer).toBeHidden()
    await expect(chat).toBeFocused()
    await expect(chat).toHaveAttribute('aria-expanded', 'false')
  })

  test('keyboard: a dialog from More blocks call shortcuts and returns focus to More', async ({ page }) => {
    test.skip(await isTouch(page), 'shortcuts and focus return are pointer-fine behaviours')
    const room = uniqueRoom('kbmodal')
    await join(page, room, 'Solo')

    const more = page.getByRole('button', { name: 'More options' })
    await more.focus()
    await page.keyboard.press('Enter')
    const settingsRow = page.getByRole('button', { name: 'Settings', exact: true })
    await settingsRow.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()

    // Radix never sets aria-modal, so the shortcut guard used to match nothing and
    // M muted you from inside Settings.
    // A CSS locator: the modal hides the bar from the accessibility tree.
    const mic = page.locator('button[aria-label="Mute microphone"], button[aria-label="Unmute microphone"]').first()
    const before = await mic.getAttribute('aria-label')
    await page.keyboard.press('m')
    await page.waitForTimeout(500)
    expect(await mic.getAttribute('aria-label'), 'M did nothing while Settings was open').toBe(before)

    // The row that opened it unmounted with the menu; focus goes back to More.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(more).toBeFocused()
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
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({
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
