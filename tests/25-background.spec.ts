import { test, expect, type Page } from '@playwright/test'
import { closeContext, isTouch, join, newParticipant, uniqueRoom } from './helpers'

/** Pretend the page went to / came back from another app. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

/** Does `viewer` see `name`'s camera as on? Read from the room, not the pixels. */
function remoteCameraOn(viewer: Page, name: string) {
  return viewer.evaluate((n) => {
    type Pub = { source: string; isMuted: boolean; track?: unknown }
    type P = { name?: string; identity: string; trackPublications: Map<string, Pub> }
    const room = (window as unknown as { __lkRoom?: { remoteParticipants: Map<string, P> } }).__lkRoom
    const p = [...(room?.remoteParticipants.values() ?? [])].find((x) => x.name === n)
    const cam = p && [...p.trackPublications.values()].find((t) => t.source === 'camera')
    return !!cam && !cam.isMuted
  }, name)
}

/**
 * A phone browser stops feeding the camera the moment you switch apps, and the
 * others were left looking at a frozen frame. Now the camera turns off while
 * you're away (they see your name) and back on when you return.
 */
test.describe('Backgrounding a phone', () => {
  test('the camera goes off while away and comes back on return', async ({ page, browser }) => {
    test.skip(!(await isTouch(page)), 'a laptop keeps capturing in a background tab')
    const room = uniqueRoom('away')
    await join(page, room, 'Ada')
    const guest = await newParticipant(browser, room, 'Grace')
    try {
      await expect.poll(() => remoteCameraOn(guest.page, 'Ada'), { timeout: 20_000 }).toBe(true)
      await setHidden(page, true)
      await expect.poll(() => remoteCameraOn(guest.page, 'Ada'), { timeout: 15_000 }).toBe(false)
      await setHidden(page, false)
      await expect.poll(() => remoteCameraOn(guest.page, 'Ada'), { timeout: 20_000 }).toBe(true)
      // …and the camera button agrees.
      await expect(page.getByRole('button', { name: /turn off camera/i }).first()).toBeAttached()
    } finally {
      await closeContext(guest.context)
    }
  })

  test('a camera you had off stays off when you come back', async ({ page, browser }) => {
    test.skip(!(await isTouch(page)), 'touch only')
    const room = uniqueRoom('away-off')
    await join(page, room, 'Ada')
    const guest = await newParticipant(browser, room, 'Grace')
    try {
      await expect.poll(() => remoteCameraOn(guest.page, 'Ada'), { timeout: 20_000 }).toBe(true)
      await page.evaluate(() =>
        (window as unknown as { __lkRoom: { localParticipant: { setCameraEnabled: (on: boolean) => Promise<unknown> } } })
          .__lkRoom.localParticipant.setCameraEnabled(false),
      )
      await expect.poll(() => remoteCameraOn(guest.page, 'Ada'), { timeout: 15_000 }).toBe(false)
      await setHidden(page, true)
      await setHidden(page, false)
      await page.waitForTimeout(3000)
      expect(await remoteCameraOn(guest.page, 'Ada')).toBe(false)
    } finally {
      await closeContext(guest.context)
    }
  })
})
