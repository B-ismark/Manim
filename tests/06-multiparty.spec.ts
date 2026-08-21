import { test, expect } from '@playwright/test'
import { uniqueRoom, newParticipant, appErrors, join, openChat, openMore, closePanel } from './helpers'

// Multi-participant flows need real LiveKit (creds in .env). Each participant is
// its own browser context so they have independent camera/mic + identity.
test.describe('Multi-party', () => {
  test('two participants see each other; chat propagates both ways', async ({ page, browser }) => {
    const room = uniqueRoom('mp')
    // Host (first joiner).
    await join(page, room, 'Host')
    // Second participant.
    const guest = await newParticipant(browser, room, 'Guest')

    try {
      // Each side shows 2 participants on the stage chip.
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({ timeout: 30_000 })
      await expect(guest.page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({ timeout: 30_000 })

      // Host sends chat → guest receives.
      const hostComposer = await openChat(page)
      await hostComposer.fill('hi from host')
      await hostComposer.press('Enter')
      const guestComposer = await openChat(guest.page)
      await expect(guest.page.getByText('hi from host')).toBeVisible({ timeout: 20_000 })

      // Guest replies → host receives.
      await guestComposer.fill('hi from guest')
      await guestComposer.press('Enter')
      await expect(page.getByText('hi from guest')).toBeVisible({ timeout: 20_000 })

      expect(appErrors(guest.sink), appErrors(guest.sink).join('\n')).toEqual([])
    } finally {
      await guest.context.close()
    }
  })

  test('three participants populate the grid for everyone', async ({ page, browser }) => {
    // The standard multi-party tests cap at 2 (audit T6) — a 2-tile grid never
    // exercises the paged grid layout. A modest 3-party ramp stays cheap enough for
    // the default suite while covering >2 tiles; the heavy ramp stays opt-in (07).
    const room = uniqueRoom('mp3')
    await join(page, room, 'Host')
    const g1 = await newParticipant(browser, room, 'Guest-1')
    const g2 = await newParticipant(browser, room, 'Guest-2')
    try {
      for (const p of [page, g1.page, g2.page]) {
        await expect(p.getByRole('button', { name: /Participants \(3\)/ })).toBeVisible({
          timeout: 40_000,
        })
      }
      expect(appErrors(g1.sink), appErrors(g1.sink).join('\n')).toEqual([])
      expect(appErrors(g2.sink), appErrors(g2.sink).join('\n')).toEqual([])
    } finally {
      await g1.context.close()
      await g2.context.close()
    }
  })

  test('waiting room: host admits a knocking guest', async ({ page, browser }) => {
    const room = uniqueRoom('lobby')
    await join(page, room, 'Host')

    // Host turns the waiting room on (More → Waiting room toggle), then closes the menu
    // by TAPPING its X — on mobile More is a modal bottom-sheet whose scrim would
    // otherwise block the admit banner (phones have no Esc key).
    await openMore(page)
    await page.getByRole('button', { name: 'Waiting room' }).click()
    await closePanel(page)

    // Guest tries to join → should land in the waiting screen.
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const guest = await ctx.newPage()
    try {
      await guest.goto(`/r/${room}`)
      await guest.getByLabel('Your name').fill('Knocker')
      await guest.getByRole('button', { name: 'Join now' }).click()
      await expect(guest.getByText('Waiting to be let in')).toBeVisible({ timeout: 30_000 })

      // Host sees the admit banner and admits.
      await expect(page.getByRole('button', { name: 'Admit' })).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Admit' }).click()

      // Guest now connects (mic control appears).
      await expect(guest.getByRole('button', { name: /microphone/i }).first()).toBeVisible({ timeout: 45_000 })
    } finally {
      await ctx.close()
    }
  })

  test('host can force-mute a guest from their tile', async ({ page, browser }) => {
    const room = uniqueRoom('mod')
    await join(page, room, 'Host')
    const guest = await newParticipant(browser, room, 'Target')
    try {
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({ timeout: 30_000 })
      // Reveal the guest tile's mute affordance (hover) and click it.
      const muteBtn = page.getByRole('button', { name: /^Mute Target/ })
      // Hover the tile region to surface the control.
      await page.getByText('Target', { exact: false }).first().hover().catch(() => {})
      await expect(muteBtn).toBeVisible({ timeout: 15_000 })
      await muteBtn.click()
      // After muting, the affordance drops (can't re-mute) — guest mic shows off.
      await expect(muteBtn).toBeHidden({ timeout: 15_000 })
    } finally {
      await guest.context.close()
    }
  })
})
