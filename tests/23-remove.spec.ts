import { test, expect } from '@playwright/test'
import { closeContext, isTouch, join, newParticipant, uniqueRoom } from './helpers'

/**
 * "Remove from call" sticks (server/removed.mjs). It used to disconnect the person
 * and nothing more: the same link let them straight back in.
 */
test('a removed guest can’t knock back in, even under another name', async ({ page, browser }) => {
  test.skip(await isTouch(page), 'one host flow is enough; the rule is server-side')
  const room = uniqueRoom('remove')
  await join(page, room, 'Host')
  const guest = await newParticipant(browser, room, 'Mallory')
  try {
    await expect(page.getByRole('button', { name: /People \(2\)/ })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /People \(2\)/ }).click()
    await page.getByRole('button', { name: 'Actions for Mallory' }).click()
    await page.getByRole('menuitem', { name: 'Remove from call' }).click()
    await page.getByRole('dialog', { name: /Remove Mallory/ }).getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByText('Mallory left the call')).toBeVisible({ timeout: 30_000 })

    // Same browser (same device id), new name: turned away at the door.
    await guest.page.goto(`/r/${room}`, { waitUntil: 'domcontentloaded' })
    await guest.page.getByLabel('Your name').fill('Not Mallory')
    await guest.page.getByRole('button', { name: 'Join now' }).click()
    await expect(guest.page.getByText('The host removed you from this call.')).toBeVisible({ timeout: 30_000 })
  } finally {
    await closeContext(guest.context)
  }
})
