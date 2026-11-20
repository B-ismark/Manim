import { test, expect } from '@playwright/test'
import { activate, closeContext, isTouch, join, newParticipant, revealChrome, uniqueRoom } from './helpers'

/**
 * Raised hands carry their place in line (Teams' "1 ✋"), on the tile and in
 * People, so a host can call on people in the order they asked.
 */
test('raised hands are numbered in the order they went up', async ({ page, browser }) => {
  test.skip(await isTouch(page), 'same data on touch; the bar route to Raise hand differs')
  const room = uniqueRoom('hands')
  await join(page, room, 'Ada')
  const guest = await newParticipant(browser, room, 'Ben')

  const raise = async (p: typeof page) => {
    await revealChrome(p)
    const trigger = p.getByRole('button', { name: /^Reactions and raise hand/ })
    await activate(p, trigger)
    await activate(p, p.getByRole('dialog').getByRole('button', { name: 'Raise hand' }))
    await expect(trigger).toHaveAccessibleName(/your hand is raised/)
    await p.keyboard.press('Escape')
  }

  // Ben first, then Ada.
  await raise(guest.page)
  await raise(page)

  // On Ada's stage: Ben is first in line, Ada second.
  await expect(page.getByLabel(/^Ben, .*hand raised, number 1 in line/)).toBeVisible()
  await expect(page.getByLabel(/^Ada \(you\), .*hand raised, number 2 in line/)).toBeVisible()

  // People lists hands first, in order, and says which one each is.
  await revealChrome(page)
  await page.getByRole('button', { name: /^Open chat/ }).click()
  await page.getByRole('tab', { name: /People/i }).click()
  await expect(page.getByText('1st hand')).toBeVisible()
  await expect(page.getByText('2nd hand')).toBeVisible()

  await closeContext(guest.context)
})
