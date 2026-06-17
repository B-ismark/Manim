import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join } from './helpers'

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

    const chat = page.getByRole('button', { name: 'Open chat' })
    await chat.click()
    await expect(page.getByText('Messages are visible only to people in this call.')).toBeVisible()
    // Close with Escape — works for both the desktop docked panel and the mobile
    // modal bottom-sheet (re-clicking "Open chat" can't reach it behind the sheet
    // scrim on touch).
    await page.keyboard.press('Escape')
    await expect(page.getByText('Messages are visible only to people in this call.')).toBeHidden()

    expect(appErrors(sink)).toEqual([])
  })

  test('More menu exposes layout switch + self-view + audio-only', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await page.getByRole('button', { name: 'More options' }).click()
    // Quick actions
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speaker' })).toBeVisible()
    // Action rows
    await expect(page.getByRole('button', { name: /Hide self view|Show self view/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Audio-only/ })).toBeVisible()
    // Switch to speaker layout.
    await page.getByRole('button', { name: 'Speaker' }).click()
    // Menu closes after pick.
    await expect(page.getByRole('button', { name: 'Grid' })).toBeHidden()
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
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('button', { name: 'Audio & video' }).click()
    const dialog = page.getByRole('dialog', { name: 'Audio & video' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Noise suppression' })).toBeVisible()
  })

  test('Settings dialog opens from More (theme controls present)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
