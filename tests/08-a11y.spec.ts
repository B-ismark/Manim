import { test, expect } from '@playwright/test'
import {
  activate,
  axeViolations,
  closeContext,
  isTouch,
  join,
  newParticipant,
  openChat,
  openEndCallMenu,
  selectStageView,
  setColorScheme,
  uniqueRoom,
} from './helpers'

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
      await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
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
      // Say "grid" and mean it on BOTH pointer types. Desktop opens in grid, but a
      // phone opens in SPEAKER, so on touch this scanned one full-bleed feed and a
      // floating card — never the tiled gallery, which is a different set of
      // elements entirely and now carries the local participant's own cell.
      if (await isTouch(page)) await selectStageView(page, 'Gallery')
      await openChat(page)
      const v = await axeViolations(page)
      await closeContext(peer.context)
      expect(v, JSON.stringify(v, null, 2)).toEqual([])
    })

    // Transient overlays (menus / dialogs) aren't in the DOM during the snapshots
    // above, so axe never sampled them — that's how a danger-TEXT-on-dark-surface
    // contrast fail (the red "End call for everyone" item) shipped green. The room
    // creator is host, so the split Leave control exposes the end-call menu. Open
    // it, then its confirm dialog, and axe each while it's actually on screen.
    test('host end-call menu + confirm dialog have no WCAG violations', async ({ page }) => {
      await setColorScheme(page, scheme)
      await join(page, uniqueRoom(), 'Ada')

      // Open whichever surface this platform offers end-for-everyone on — the
      // caret's dropdown on a pointer, the More sheet on touch — and axe it while
      // it is actually mounted. Both render the danger item whose contrast
      // regressed; only one of them is a menu.
      const item = await openEndCallMenu(page)
      await expect(item).toBeVisible()
      const menuViolations = await axeViolations(page)
      expect(menuViolations, JSON.stringify(menuViolations, null, 2)).toEqual([])

      // Selecting it opens the confirm dialog — axe its content too.
      await activate(page, item)
      await expect(page.getByRole('heading', { name: 'End the call for everyone?' })).toBeVisible()
      const dialogViolations = await axeViolations(page)
      expect(dialogViolations, JSON.stringify(dialogViolations, null, 2)).toEqual([])
    })
  })
}
