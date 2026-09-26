import { test, expect } from '@playwright/test'
import { closeContext, newParticipant, revealChrome, uniqueRoom } from './helpers'

/**
 * The join screen says who's in the call before you knock (server
 * handleRoomStatus → useRoomReadiness), so nobody walks into an empty room, or
 * one whose host isn't there, without knowing. It never names anyone, and it
 * tells someone without the invite link nothing at all.
 */
test.describe('Join screen readiness', () => {
  test('counts the people in, and says when the host isn’t there', async ({ page, browser }) => {
    const room = uniqueRoom('ready')
    await page.goto(`/r/${room}`)
    await page.getByLabel('Your name').fill('Kofi')
    const line = page.getByTestId('room-readiness')
    await expect(line).toHaveText('No one else is here yet', { timeout: 20_000 })

    const host = await newParticipant(browser, room, 'Ama')
    const guest = await newParticipant(browser, room, 'Esi')
    try {
      // The screen polls; reopening it asks straight away.
      await page.reload()
      await expect(line).toHaveText('2 people in the call', { timeout: 20_000 })
      await expect(line, 'never names anyone').not.toContainText(/Ama|Esi/)

      await revealChrome(host.page)
      await host.page.getByRole('button', { name: 'Leave call' }).click()
      await page.reload()
      await expect(line).toHaveText('1 in the call · Host isn’t here yet', { timeout: 30_000 })
    } finally {
      await closeContext(host.context)
      await closeContext(guest.context)
    }
  })

  test('a link room tells someone without its secret nothing', async ({ page, request }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New meeting' }).click()
    await expect(page).toHaveURL(/#k=/)
    const url = new URL(page.url())
    const room = url.pathname.split('/').pop()!
    const secret = new URLSearchParams(url.hash.slice(1)).get('k')!
    await page.getByLabel('Your name').fill('Ama')
    await page.getByRole('button', { name: 'Join now' }).click()
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible({ timeout: 45_000 })

    const ask = async (body: object) => (await request.post('/api/room-status', { data: { room, ...body } })).json()
    await expect.poll(() => ask({ secret }).then((r) => r.state), { timeout: 15_000 }).toBe('live')
    // Wrong or missing secret: the same answer an empty or unknown room gives.
    expect(await ask({})).toEqual({ state: 'unknown' })
    expect(await ask({ secret: secret.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })).toEqual({ state: 'unknown' })
    // Your own seat isn't counted as someone waiting for you.
    const mine = await ask({ secret })
    expect(mine.count).toBe(1)
  })
})
