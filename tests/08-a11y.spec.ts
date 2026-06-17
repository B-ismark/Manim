import { test, expect } from '@playwright/test'
import { uniqueRoom, join, openChat, axeViolations, setColorScheme, newParticipant } from './helpers'

/**
 * Automated WCAG 2.1 A/AA sweep (axe-core) across every surface in BOTH colour
 * schemes. This is what catches contrast / ARIA / focus regressions automatically
 * — e.g. the dark-mode contrast fails that previously needed a manual Lighthouse
 * pass. Landing + prejoin run without LiveKit creds; the in-call cases need them
 * (CI provides them as secrets), so they're grouped separately.
 */
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`a11y · ${scheme} · no-room`, () => {
    test('landing has no WCAG violations', async ({ page }) => {
      await setColorScheme(page, scheme)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Start or join a call' })).toBeVisible()
      const v = await axeViolations(page)
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })

    test('prejoin has no WCAG violations', async ({ page }) => {
      await setColorScheme(page, scheme)
      await page.goto(`/r/${uniqueRoom()}`)
      await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible({ timeout: 20_000 })
      const v = await axeViolations(page)
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })
  })
}

// In-call axe needs a live room (CI secrets). Two-party so tiles + roster render.
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`a11y · ${scheme} · in-call`, () => {
    test('solo stage has no WCAG violations', async ({ page }) => {
      await setColorScheme(page, scheme)
      await join(page, uniqueRoom(), 'Ada')
      const v = await axeViolations(page)
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })

    test('grid + chat panel open has no WCAG violations', async ({ page, browser }) => {
      await setColorScheme(page, scheme)
      const room = uniqueRoom()
      await join(page, room, 'Ada')
      const peer = await newParticipant(browser, room, 'Grace')
      await openChat(page)
      const v = await axeViolations(page)
      await peer.context.close()
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })
  })
}
