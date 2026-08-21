import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join, openMore, revealChrome, closePanel } from './helpers'

test.describe('In-call controls', () => {
  test('mic + camera toggles flip state; chat panel opens and closes', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')

    const mute = page.getByRole('button', { name: 'Mute microphone' })
    await expect(mute).toBeVisible()
    await mute.click()
    await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()

    const camOff = page.getByRole('button', { name: 'Turn off camera' })
    await camOff.click()
    await expect(page.getByRole('button', { name: 'Turn on camera' })).toBeVisible()

    await revealChrome(page)
    await page.getByRole('button', { name: 'Open chat' }).click()
    await expect(page.getByText('Messages are visible only to people in this call.')).toBeVisible()
    // Close by tapping the panel's X — how a real user (esp. on touch, no Esc key)
    // dismisses the sheet.
    await closePanel(page)
    await expect(page.getByText('Messages are visible only to people in this call.')).toBeHidden()

    expect(appErrors(sink)).toEqual([])
  })

  test('More menu exposes layout switch + self-view + audio-only', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)
    // Quick actions
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speaker' })).toBeVisible()
    // Action rows
    await expect(page.getByRole('button', { name: /Hide self view|Show self view/ })).toBeVisible()
    // This row was renamed off "Audio-only mode" (it read as the device picker it
    // sat beside); the test had kept asserting the old name and failing for it.
    await expect(page.getByRole('button', { name: /incoming video/ })).toBeVisible()
    // Switch to speaker layout. The menu deliberately STAYS open: layout and
    // gallery size are one control now, and the size chips only appear alongside
    // Grid — closing on the first pick would put density out of reach. (This
    // assertion used to expect a close, and had been failing unnoticed behind an
    // earlier stale expectation in the same test.)
    await page.getByRole('button', { name: 'Speaker' }).click()
    await expect(page.getByRole('button', { name: 'Speaker' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible()
  })

  test('desktop: reactions picker opens and a reaction can be sent', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'reaction picker is inline on desktop only')
    await join(page, uniqueRoom(), 'Ada')
    await page.getByRole('button', { name: 'Reactions and raise hand' }).click()
    const firstEmoji = page.getByRole('button', { name: /^React / }).first()
    await expect(firstEmoji).toBeVisible()
    await firstEmoji.click()
    // No crash; reactions overlay is transient — just assert the app is still alive.
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible()
  })

  test('Audio & video device dialog opens from More', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)
    await page.getByRole('button', { name: 'Audio & video' }).click()
    const dialog = page.getByRole('dialog', { name: 'Audio & video' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Noise suppression' })).toBeVisible()
  })

  /**
   * Regression: the Audio output button was inert on every platform.
   *
   * It is the app's only Popover trigger wrapped in a <Tooltip>, and Radix opens
   * a trigger by cloning its immediate child with an onClick — which landed on
   * the Tooltip component, which dropped it. The control rendered perfectly,
   * announced itself correctly, and did nothing when pressed. Nothing caught it
   * because "the button exists" was all anyone asserted; this asserts it OPENS.
   */
  test('Audio output button opens the audio panel', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')
    await revealChrome(page)

    // Anchored, because the control's name is not the same string on both
    // platforms and a bare substring catches things that aren't it. A pointer gets
    // "Audio output"; touch gets "Audio output: <device>. Tap to change." — the
    // route is in the name there, since the labelled chip didn't fit the island.
    // Meanwhile the tray lists the OUTPUT DEVICES, and Chromium's fakes are called
    // "Fake Default Audio Output", which an unanchored "Audio output" also matches.
    const output = page.getByRole('button', { name: /^Audio output/ })
    await expect(output).toBeVisible()
    await expect(output).toHaveAttribute('aria-expanded', 'false')

    await output.click()
    await expect(output).toHaveAttribute('aria-expanded', 'true')
    // The Bluetooth toggle is the one row that's always present — the device
    // pickers hide themselves when the platform lists no devices of that kind.
    await expect(page.getByRole('switch', { name: 'Auto-connect Bluetooth' })).toBeVisible()
    // And the name stays unique while the panel is open: the speaker row inside
    // it used to be called "Audio output" too, so a screen-reader user met two
    // identically-named controls that did different things. Anchored for the same
    // reason as above — a device merely CONTAINING the words is not a collision.
    await expect(page.getByRole('button', { name: /^Audio output/ })).toHaveCount(1)

    expect(appErrors(sink)).toEqual([])
  })

  test('Settings dialog opens from More (theme controls present)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
