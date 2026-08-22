import { test, expect } from '@playwright/test'
import {
  uniqueRoom,
  attachErrorSink,
  appErrors,
  join,
  openMore,
  revealChrome,
  closePanel,
  isTouch,
  activate,
} from './helpers'

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
    // Switch to speaker layout. The menu deliberately STAYS open — a view is a
    // thing you flip between to see which you want, and closing on the first pick
    // makes comparing them a four-tap round trip. (This assertion used to expect a
    // close, and had been failing unnoticed behind an earlier stale expectation in
    // the same test.)
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
   * The bar's audio control opens the audio panel — one control per platform, and
   * it actually opens.
   *
   * Regression, and worth keeping in this shape: the control was once INERT on
   * every platform. It was the app's only Popover trigger wrapped in a <Tooltip>,
   * and Radix opens a trigger by cloning its immediate child with an onClick —
   * which landed on the Tooltip component, which dropped it. It rendered
   * perfectly, announced itself correctly, and did nothing when pressed. Nothing
   * caught that, because "the button exists" was all anyone asserted.
   *
   * The two platforms take different routes now, which is the point of the split
   * below rather than an inconvenience:
   *  - TOUCH has one dedicated control, `Audio output: <device>. Tap to change.`,
   *    opening the island's own tray. There are no device carets on touch at all
   *    (11-mobile-fit guards that), so this is the route.
   *  - DESKTOP reaches the same `AudioDevicePanel` through the mic's caret, and
   *    only through it. A second bar button used to open that identical panel;
   *    that button is what got removed, so this also pins the removal — if it ever
   *    comes back, "exactly one control opens this" starts failing.
   */
  test('the audio panel opens from the bar, from exactly one control', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')
    await revealChrome(page)
    const touch = await isTouch(page)

    // Anchored `^Audio output`, always: the tray/panel lists the OUTPUT DEVICES,
    // and Chromium's fakes are called "Fake Default Audio Output", which an
    // unanchored substring happily matches.
    const trigger = touch
      ? page.getByRole('button', { name: /^Audio output/ })
      : page.getByRole('button', { name: 'Audio options' })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await activate(page, trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // The Bluetooth toggle is the one row that's always present — the device
    // pickers hide themselves when the platform lists no devices of that kind.
    await expect(page.getByRole('switch', { name: 'Auto-connect Bluetooth' })).toBeVisible()

    // ONE control named for audio output, panel open or not. On touch that's the
    // tray trigger; on desktop it's zero — the panel's own speaker row is called
    // "Speaker", deliberately, so a screen-reader user never meets two
    // identically-named controls doing different things.
    await expect(page.getByRole('button', { name: /^Audio output/ })).toHaveCount(touch ? 1 : 0)

    expect(appErrors(sink)).toEqual([])
  })

  test('Settings dialog opens from More (theme controls present)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  /**
   * A phone offers no screen-share control at all, because it cannot ever work.
   *
   * This is the case EVERY REAL PHONE is in and no emulated one is: screen capture
   * is a desktop-only web feature (WebKit has never shipped `getDisplayMedia`, and
   * neither Chrome nor Firefox for Android has either — capture there goes through
   * ReplayKit / MediaProjection, native APIs a web page cannot reach). Playwright's
   * "Pixel 7" is desktop Chromium wearing a mobile user-agent and a touch viewport,
   * so it reports screen capture as fully supported and renders the ordinary Share
   * screen tile. Removing the API is the only way the real mobile path is visible in
   * a browser test at all, the same trick 11-mobile-fit uses to raise a keyboard.
   *
   * Both branches are asserted, in order, so this cannot pass by the tile always
   * being absent — which is the failure mode that matters, since `supported` is one
   * boolean away from hiding the control on desktop too.
   */
  test('a phone with no screen capture is offered no share control', async ({ page }) => {
    test.skip(!(await isTouch(page)), 'the share tile only lives in More on touch')
    const sink = attachErrorSink(page)

    // First: this browser DOES have the API, so the tile is there.
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)
    // `exact`, because the at-capacity label is "Share screen (in use)" and the
    // accessible name is matched as a substring by default.
    await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeVisible()

    // Now take the API away and rejoin. `defineProperty`, not `delete` — the method
    // lives on MediaDevices.prototype, so an own undefined property is what shadows
    // it. Before navigation, because `useScreenShare` reads it on first render.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: undefined,
        configurable: true,
      })
    })
    await join(page, uniqueRoom(), 'Ada')
    await openMore(page)

    // Nothing named for sharing a screen, anywhere — not the tile, not a dimmed
    // stand-in, and not the desktop bar control leaking through a `hidden` class
    // the cascade ignores (which is how that control once reached phones).
    await expect(page.getByRole('button', { name: /share screen/i })).toHaveCount(0)
    // …and the sheet still works, rather than having thrown on the way up.
    await expect(page.getByRole('button', { name: 'Mini player' })).toBeVisible()

    expect(appErrors(sink)).toEqual([])
  })
})
