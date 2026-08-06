import { test, expect } from '@playwright/test'
import { uniqueRoom, join, revealChrome, isTouch } from './helpers'

/**
 * The People panel's invite surface.
 *
 * "Invite by email" and "Add from contacts" used to be two controls asking for
 * one thing — naming a person — so they collapsed into a single input behind an
 * "Add people" disclosure. The risk in that merge is quietly narrowing what the
 * old form accepted, which is what these cover.
 */
test.describe('People panel @people', () => {
  test('Copy link stays out front; everything else is one disclosure', async ({ page }) => {
    await join(page, uniqueRoom('people'), 'Ada')
    await revealChrome(page)
    await page.getByRole('button', { name: 'Open chat' }).click()
    await page.getByRole('tab', { name: /People/i }).click()

    // The zero-friction invite is the most-used one and must not be buried.
    await expect(page.getByRole('button', { name: /Copy link/i })).toBeVisible()

    // Nothing that asks for an address is on screen until asked for.
    const trigger = page.getByRole('button', { name: /Add people/i })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('input[placeholder*="email" i]')).toHaveCount(0)

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('input[placeholder*="email" i]').first()).toBeVisible()

    // The audit's L4 disclosure travels with the input that collects the address.
    await expect(page.getByText(/we'll email them an invite/i)).toBeVisible()
  })

  /**
   * The gate that decides whether to OFFER an invite is deliberately loose, and
   * this is why. It began as /^\S+@\S+\.\S+$/ — a dot required in the domain —
   * which silently refused `bob@localhost` and every intranet address: no
   * matching contact, no invite row, no way through at all. The old form always
   * offered Invite and let the server judge. A stricter pattern here validates
   * nothing; it only removes the path for anyone it disagrees with.
   */
  test('an address without a dotted domain can still be invited', async ({ page }) => {
    test.skip(await isTouch(page), 'covered on desktop; the panel is identical either way')
    await join(page, uniqueRoom('people'), 'Ada')
    await revealChrome(page)
    await page.getByRole('button', { name: 'Open chat' }).click()
    await page.getByRole('tab', { name: /People/i }).click()
    await page.getByRole('button', { name: /Add people/i }).click()

    const box = page.locator('input[placeholder*="email" i]').first()
    const invite = page.getByRole('button', { name: /^Invite$/ })

    await box.fill('bob@localhost')
    await expect(invite, 'an intranet address must still have a way through').toBeVisible()

    await box.fill('bob@company.com')
    await expect(invite).toBeVisible()

    // Free text is a contact search, not an address — offering to email it would
    // be nonsense, so the action stays away until there is something to send to.
    await box.fill('just some text')
    await expect(invite).toHaveCount(0)
  })
})
