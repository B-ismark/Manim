import { test, expect } from '@playwright/test'
import { uniqueRoom, join, newParticipant, appErrors, revealChrome } from './helpers'

// E2EE was never exercised (audit T3 / finding S5). The encryption key rides the
// URL fragment (#e=…); RoomView calls room.setE2EEEnabled(true) and only flips the
// "End-to-end encrypted" badge AFTER that promise resolves (on failure it hides the
// badge + raises a danger toast). So asserting the badge is present is a real-state
// check — it would catch a regression where the lock shows on intent (S5) or where
// E2EE silently fails to initialise.
test.describe('E2EE — encrypted call', () => {
  test('two peers with a matching key connect and both show the encrypted badge', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom('e2ee')
    const hash = '#e=testkey-e2e-match'

    await join(page, room, 'Alice', hash)
    const guest = await newParticipant(browser, room, 'Bob', hash)

    try {
      // Both sides negotiate media (so the encryption pipeline didn't break the call).
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })
      await expect(guest.page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })

      // The badge lives in CallStatusBar, which UNMOUNTS with the touch chrome (~4s
      // after the last tap) rather than sliding away — so on a phone the two waits
      // above can outlive it and the lock is legitimately absent from the DOM. Reveal
      // first; without this the spec is a coin flip on the mobile project under load.
      await revealChrome(page)
      await revealChrome(guest.page)

      // The badge reflects ACTUAL room E2EE state (set only after setE2EEEnabled resolves).
      await expect(page.getByLabel('End-to-end encrypted')).toBeVisible({ timeout: 20_000 })
      await expect(guest.page.getByLabel('End-to-end encrypted')).toBeVisible({ timeout: 20_000 })

      // Strict sink: a healthy E2EE call must not log the connection / insertable-
      // streams errors that signal a silent encryption failure (S5). The default
      // appErrors() suppresses those everywhere; here we deliberately surface them.
      const strict = appErrors(guest.sink, { strict: true })
      expect(strict, strict.join('\n')).toEqual([])
    } finally {
      await guest.context.close()
    }
  })

  test('mismatched keys surface a warning instead of silently dropping media', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom('e2ee-x')
    // Two peers on DIFFERENT keys: each encrypts locally fine (padlock stays), but
    // neither can decrypt the other → LiveKit fires EncryptionError, which the app
    // turns into a throttled "Encryption mismatch" toast (RoomView). Without that,
    // a stale invite link would just look like a frozen/black peer with no reason.
    await join(page, room, 'Alice', '#e=key-alpha')
    const guest = await newParticipant(browser, room, 'Bob', '#e=key-beta')

    try {
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })
      // The decrypt failure (needs real frames to flow) is surfaced, not swallowed.
      await expect(page.getByText(/Encryption mismatch/i)).toBeVisible({ timeout: 45_000 })
      // Local encryption is still on for the mismatched peer — the padlock holds.
      // Revealed first, for the same reason as the matching-key test above.
      await revealChrome(page)
      await expect(page.getByLabel('End-to-end encrypted')).toBeVisible()
    } finally {
      await guest.context.close()
    }
  })
})
