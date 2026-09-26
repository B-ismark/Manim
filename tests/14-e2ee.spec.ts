import { test, expect } from '@playwright/test'
import {
  appErrors,
  closeContext,
  expectChromeVisible,
  join,
  newParticipant,
  openChat,
  uniqueRoom,
} from './helpers'

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
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })
      await expect(guest.page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })

      // The badge reflects ACTUAL room E2EE state (set only after setE2EEEnabled
      // resolves). Asserted through expectChromeVisible because it lives in
      // CallStatusBar, which UNMOUNTS with the touch chrome rather than sliding
      // away: on a phone the 30s wait above routinely outlives the 4s countdown,
      // and the padlock is then legitimately absent rather than missing.
      await expectChromeVisible(page, page.getByLabel('End-to-end encrypted'))
      await expectChromeVisible(guest.page, guest.page.getByLabel('End-to-end encrypted'))

      // Strict sink: a healthy E2EE call must not log the connection / insertable-
      // streams errors that signal a silent encryption failure (S5). The default
      // appErrors() suppresses those everywhere; here we deliberately surface them.
      const strict = appErrors(guest.sink, { strict: true })
      expect(strict, strict.join('\n')).toEqual([])
    } finally {
      await closeContext(guest.context)
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
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })
      // The decrypt failure (needs real frames to flow) is surfaced, not swallowed.
      await expect(page.getByText(/Encryption mismatch/i)).toBeVisible({ timeout: 45_000 })
      // Local encryption is still on for the mismatched peer — the padlock holds.
      // Chrome-gated, for the same reason as the matching-key test above.
      await expectChromeVisible(page, page.getByLabel('End-to-end encrypted'))
    } finally {
      await closeContext(guest.context)
    }
  })

  test('a guest whose link has no key is told to get the full link, not let into a call they can’t decode', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom('e2ee-nokey')
    await join(page, room, 'Alice', '#e=testkey-e2e-door')
    // The host marks the room once its encryption is really on (the padlock); wait
    // until the server agrees, so the guest below meets the marked room.
    await expectChromeVisible(page, page.getByLabel('End-to-end encrypted'))
    await expect
      .poll(
        async () =>
          (await page.request.post('/api/knock', { data: { room, name: 'Probe', deviceId: 'probe', hasKey: false } }))
            .status(),
        { timeout: 15_000 },
      )
      .toBe(409)

    // What an emailed invite opens: the room, without the key. A fresh context,
    // so no remembered key either.
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const guest = await context.newPage()
    try {
      await guest.goto(`/r/${room}`, { waitUntil: 'domcontentloaded' })
      await guest.getByLabel('Your name').fill('Bob')
      await guest.getByRole('button', { name: 'Join now' }).click()
      await expect(guest.getByRole('heading', { name: 'This call is encrypted' })).toBeVisible({ timeout: 20_000 })
      await expect(guest.getByRole('button', { name: /microphone/i })).toHaveCount(0)
      // Alice is still alone: the keyless knock never became a seat.
      await expect(page.getByRole('button', { name: /People \(1\)/ })).toBeVisible()
    } finally {
      await closeContext(context)
    }
  })

  test('on an encrypted call, chat is end-to-end encrypted too and still gets through', async ({
    page,
    browser,
  }) => {
    // lib/livekit uses `encryption` (media AND data channel). This guards the
    // failure that change could cause: chat that no longer decrypts on arrival.
    const room = uniqueRoom('e2ee-chat')
    const hash = '#e=testkey-e2e-chat'
    await join(page, room, 'Alice', hash)
    const guest = await newParticipant(browser, room, 'Bob', hash)
    try {
      await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({ timeout: 30_000 })
      await expectChromeVisible(page, page.getByLabel('End-to-end encrypted'))
      const composer = await openChat(page)
      await composer.fill('sealed hello')
      await composer.press('Enter')
      const bobComposer = await openChat(guest.page)
      await expect(guest.page.getByText('sealed hello')).toBeVisible({ timeout: 20_000 })
      await bobComposer.fill('sealed reply')
      await bobComposer.press('Enter')
      await expect(page.getByText('sealed reply')).toBeVisible({ timeout: 20_000 })
    } finally {
      await closeContext(guest.context)
    }
  })
})
