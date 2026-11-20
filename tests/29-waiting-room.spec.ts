import { test, expect } from '@playwright/test'
import { activate, axeViolations, closeContext, closePanel, join, openHostControls, uniqueRoom } from './helpers'

/**
 * The waiting room isn't a dead end (islands/WaitingRoom): the guest sees
 * themselves, can fix the name the host will admit and leave the host a note,
 * and the host's banner shows both before they decide.
 */
test.describe('Waiting room', () => {
  test('a waiting guest fixes their name and leaves a note; the host sees both', async ({ page, browser }, info) => {
    test.setTimeout(120_000)
    const room = uniqueRoom('lobby2')
    await join(page, room, 'Host')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    const ctx = await browser.newContext({ ...info.project.use, permissions: ['camera', 'microphone'] })
    const guest = await ctx.newPage()
    try {
      await guest.goto(`/r/${room}`)
      await guest.getByLabel('Your name').fill('Kofii')
      await guest.getByRole('button', { name: 'Join now' }).click()
      await expect(guest.getByText('Waiting to be let in')).toBeVisible({ timeout: 30_000 })
      await expect(guest.getByTestId('waiting-preview')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Admit Kofii' })).toBeVisible({ timeout: 30_000 })

      // Fix the typo.
      await activate(guest, guest.getByRole('button', { name: 'Edit your name' }))
      await guest.getByLabel('Your name').fill('Kofi')
      await activate(guest, guest.getByRole('button', { name: 'Save' }))
      await expect(guest.getByRole('button', { name: 'Edit your name' })).toBeVisible()

      // Leave a note.
      await activate(guest, guest.getByRole('button', { name: 'Add a note for the host' }))
      await guest.getByLabel('Note for the host').fill('From the design team')
      await activate(guest, guest.getByRole('button', { name: 'Send' }))
      await expect(guest.getByText('“From the design team”')).toBeVisible()
      // Nothing on the waiting screen scrolls the page, even on the short phone.
      expect(await guest.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1)
      await guest.screenshot({ path: `test-results/shots/29-waiting-${info.project.name}.png` })
      expect(await axeViolations(guest)).toEqual([])

      // Camera off shows who you are instead; the choice carries into the call.
      await activate(guest, guest.getByRole('button', { name: 'Turn camera off' }))
      await expect(guest.getByTestId('waiting-preview')).toHaveCount(0)

      // The host sees the new name and the note, and admits.
      await expect(page.getByText('“From the design team”')).toBeVisible({ timeout: 30_000 })
      await page.screenshot({ path: `test-results/shots/29-host-banner-${info.project.name}.png` })
      await activate(page, page.getByRole('button', { name: 'Admit Kofi' }))
      await expect(guest.getByRole('region', { name: 'Call controls' })).toBeAttached({ timeout: 45_000 })
      await expect(page.getByRole('button', { name: /People, 2$/ })).toBeAttached({ timeout: 30_000 })
      await expect(page.getByText('Kofi', { exact: true }).first()).toBeAttached()
    } finally {
      await closeContext(ctx)
    }
  })

  test('a waiting guest can’t rename into the host’s seat', async ({ page, request }) => {
    const room = uniqueRoom('lobby-seat')
    const hostKnock = page.waitForResponse((r) => r.url().includes('/api/knock') && r.request().method() === 'POST')
    await join(page, room, 'Host')
    const { identity } = await (await hostKnock).json()
    const hostDevice = String(identity).split('#').slice(1).join('#')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    // Eve knocks from the host's device id under another name, and is queued...
    const knock = await request.post('/api/knock', { data: { room, name: 'Eve', deviceId: hostDevice } })
    const queued = await knock.json()
    expect(queued.pending).toBe(true)
    // ...but can't then take the host's name (and with it the host's seat).
    const res = await request.post('/api/knock-update', {
      data: { room, requestId: queued.requestId, claim: queued.claim, name: 'Host' },
    })
    expect(res.status()).toBe(409)
    expect((await res.json()).code).toBe('seat_taken')
    // A name nobody holds is fine.
    const ok = await request.post('/api/knock-update', {
      data: { room, requestId: queued.requestId, claim: queued.claim, name: 'Eve B' },
    })
    expect(ok.status()).toBe(200)
  })

  // Every knock rewrites the whole sealed queue in room metadata. Two landing
  // together used to erase one (the later write replacing the earlier): that guest
  // read "Waiting to be let in" and then expired, never on the host's banner.
  // server/queueWrite.mjs re-reads after each write and redoes a lost change.
  test('two guests knocking at the same moment both reach the host', async ({ page, browser }, info) => {
    test.setTimeout(150_000)
    const room = uniqueRoom('lobby-race')
    await join(page, room, 'Host')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    const names = ['Esi', 'Kwame']
    const guests = await Promise.all(
      names.map(async (name) => {
        const ctx = await browser.newContext({ ...info.project.use, permissions: ['camera', 'microphone'] })
        const g = await ctx.newPage()
        await g.goto(`/r/${room}`)
        await g.getByLabel('Your name').fill(name)
        return { ctx, g }
      }),
    )
    try {
      // Both presses in the same tick: their knocks reach the server together.
      await Promise.all(guests.map(({ g }) => g.getByRole('button', { name: 'Join now' }).click()))
      for (const { g } of guests) await expect(g.getByText('Waiting to be let in')).toBeVisible({ timeout: 30_000 })
      for (const name of names) {
        await expect(page.getByRole('button', { name: `Admit ${name}` })).toBeVisible({ timeout: 30_000 })
      }
      // ...and both are really let in, not just listed.
      for (const name of names) await activate(page, page.getByRole('button', { name: `Admit ${name}` }))
      for (const { g } of guests) {
        await expect(g.getByRole('region', { name: 'Call controls' })).toBeAttached({ timeout: 60_000 })
      }
    } finally {
      for (const { ctx } of guests) await closeContext(ctx)
    }
  })

  test('a burst of simultaneous knocks keeps every one', async ({ page, request }) => {
    const room = uniqueRoom('lobby-burst')
    await join(page, room, 'Host')
    await openHostControls(page)
    await activate(page, page.getByRole('button', { name: 'Waiting room' }))
    await closePanel(page)

    const names = ['Abena', 'Yaw', 'Akosua', 'Kojo']
    const knocks = await Promise.all(
      names.map((name, i) => request.post('/api/knock', { data: { room, name, deviceId: `burst-${i}` } })),
    )
    for (const k of knocks) expect((await k.json()).pending).toBe(true)
    for (const name of names) {
      await expect(page.getByRole('button', { name: `Admit ${name}` })).toBeVisible({ timeout: 30_000 })
    }
  })

  test('only the guest who knocked can change their request', async ({ request }) => {
    const room = uniqueRoom('lobby-api')
    const res = await request.post('/api/knock-update', { data: { room, requestId: 'anything', claim: 'nope', note: 'hi' } })
    expect(res.status()).toBe(403)
  })
})
