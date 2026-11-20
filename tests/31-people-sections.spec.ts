import { test, expect } from '@playwright/test'
import { activate, axeViolations, closeContext, closePanel, join, newParticipant, openHostControls, revealChrome, uniqueRoom } from './helpers'

/**
 * People is a searchable list in sections — Waiting, In this call, Invited — each
 * with its count and its bulk action in its own header (Teams' People panel).
 */
async function openPeople(page: import('@playwright/test').Page) {
  await revealChrome(page)
  await page.getByRole('button', { name: /^Open chat/ }).click()
  await page.getByRole('tab', { name: /People/i }).click()
}

test.describe('People sections @people', () => {
  test('search narrows every section; Esc clears it before closing the panel', async ({ page, browser }) => {
    // Search normally needs 8 people; pin it to 1 rather than fill a call with browsers.
    await page.addInitScript(() => {
      ;(globalThis as { __MN_PEOPLE_SEARCH_MIN?: number }).__MN_PEOPLE_SEARCH_MIN = 1
    })
    const room = uniqueRoom('psearch')
    await join(page, room, 'Ada')
    const guest = await newParticipant(browser, room, 'Benjamín')
    try {
      await expect(page.getByRole('button', { name: /People, 2$/ })).toBeAttached({ timeout: 30_000 })
      await openPeople(page)

      const call = page.getByRole('region', { name: /^In this call \(2\)$/ })
      await expect(call).toBeVisible()
      // The host's bulk action sits in the section's own header.
      await expect(call.getByRole('button', { name: 'Mute all' })).toBeVisible()
      // Headings, disclosure buttons and the search box all pass axe.
      expect(await axeViolations(page)).toEqual([])

      const search = page.getByRole('searchbox', { name: 'Search people' })
      await search.fill('benjamin') // no accent typed; the name has one
      await expect(page.getByRole('region', { name: /^In this call \(1\)$/ })).toBeVisible()
      // "Mute all" would still mean all of them, not the one match: it steps aside.
      await expect(page.getByRole('button', { name: 'Mute all' })).toHaveCount(0)
      await expect(page.getByText('Benjamín', { exact: true }).last()).toBeVisible()

      await search.fill('zzz')
      await expect(page.getByRole('status').filter({ hasText: 'No one called “zzz” here' })).toBeVisible()

      // Esc empties the box and leaves People open; a second Esc closes it.
      await search.press('Escape')
      await expect(search).toHaveValue('')
      await expect(search).toBeVisible()
      await expect(page.getByRole('region', { name: /^In this call \(2\)$/ })).toBeVisible()

      // A section folds away and says so.
      const toggle = page.getByRole('button', { name: /^In this call \(2\)$/ })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    } finally {
      await closeContext(guest.context)
    }
  })

  test('a knock shows in People’s Waiting section, and Admit there lets them in', async ({ page, browser }, info) => {
    test.setTimeout(120_000)
    const room = uniqueRoom('pwait')
    await join(page, room, 'Host')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    const ctx = await browser.newContext({ ...info.project.use, permissions: ['camera', 'microphone'] })
    const guest = await ctx.newPage()
    try {
      await guest.goto(`/r/${room}`)
      await guest.getByLabel('Your name').fill('Esi')
      await guest.getByRole('button', { name: 'Join now' }).click()
      await expect(guest.getByText('Waiting to be let in')).toBeVisible({ timeout: 30_000 })

      await openPeople(page)
      const waiting = page.getByRole('region', { name: /^Waiting \(1\)$/ })
      await expect(waiting).toBeVisible({ timeout: 30_000 })
      // By keyboard: the row (and the button) go, and focus must not fall to <body>.
      await waiting.getByRole('button', { name: 'Admit Esi' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: /^In this call/ })).toBeFocused()

      await expect(guest.getByRole('region', { name: 'Call controls' })).toBeAttached({ timeout: 45_000 })
      await expect(page.getByRole('region', { name: /^In this call \(2\)$/ })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('region', { name: /^Waiting/ })).toHaveCount(0)
    } finally {
      await closeContext(ctx)
    }
  })

  // The banner sends admits one at a time, and the server re-checks each queue
  // write (server/queueWrite.mjs); both of these must get in.
  test('Admit all lets every waiting guest in', async ({ page, browser }, info) => {
    test.setTimeout(150_000)
    const room = uniqueRoom('padmit')
    await join(page, room, 'Host')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    // They knock TOGETHER: two knocks landing at once used to lose one server-side
    // (each rewrote the whole queue); server/queueWrite.mjs now redoes a lost change.
    await openPeople(page)
    const guests = await Promise.all(
      ['Esi', 'Kwame'].map(async (name) => {
        const ctx = await browser.newContext({ ...info.project.use, permissions: ['camera', 'microphone'] })
        const g = await ctx.newPage()
        await g.goto(`/r/${room}`)
        await g.getByLabel('Your name').fill(name)
        return { ctx, g }
      }),
    )
    await Promise.all(guests.map(({ g }) => g.getByRole('button', { name: 'Join now' }).click()))
    for (const { g } of guests) await expect(g.getByText('Waiting to be let in')).toBeVisible({ timeout: 30_000 })
    try {
      const waiting = page.getByRole('region', { name: /^Waiting \(2\)$/ })
      await expect(waiting).toBeVisible({ timeout: 30_000 })
      await activate(page, waiting.getByRole('button', { name: 'Admit all' }))
      for (const { g } of guests) {
        await expect(g.getByRole('region', { name: 'Call controls' })).toBeAttached({ timeout: 60_000 })
      }
      await expect(page.getByRole('region', { name: /^In this call \(3\)$/ })).toBeVisible({ timeout: 30_000 })
    } finally {
      for (const { ctx } of guests) await closeContext(ctx)
    }
  })
})
