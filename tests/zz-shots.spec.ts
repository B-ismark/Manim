// TEMPORARY, uncommitted: capture the reworked layouts so they can be looked at.
import { test, expect } from '@playwright/test'
import {
  uniqueRoom,
  join,
  newParticipant,
  revealChrome,
  closePanel,
  fakeScreenShare,
  startScreenShare,
} from './helpers'

const OUT = '/tmp/claude-0/-home-user-Manim/ff8e4ad5-5bb7-5dc3-928a-212c1b5d2325/scratchpad/shots'

async function inCall(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible({ timeout: 45_000 })
}

async function setView(page: import('@playwright/test').Page, name: 'Grid' | 'Speaker') {
  await revealChrome(page)
  const more = page.getByRole('button', { name: 'More options' })
  const opt = page.getByRole('button', { name, exact: true })
  if (!(await opt.isVisible().catch(() => false))) await more.click()
  await expect(opt).toBeVisible({ timeout: 15_000 })
  await opt.click()
  await closePanel(page)
  await revealChrome(page)
}

test('desktop layouts', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop')
  const room = uniqueRoom()
  await join(page, room, 'Bismark')
  await inCall(page)
  const peers = []
  for (const n of ['Ama', 'Kofi', 'Yaw', 'Abena']) peers.push(await newParticipant(browser, room, n))
  await page.waitForTimeout(4000)

  await setView(page, 'Grid')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/desktop-gallery.png` })

  await setView(page, 'Speaker')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/desktop-speaker.png` })

  await Promise.all(peers.map((p) => p.context.close()))
})

test('desktop content share', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'desktop')
  const room = uniqueRoom()
  await join(page, room, 'Bismark')
  await inCall(page)
  const peers = []
  for (const n of ['Ama', 'Kofi', 'Yaw']) peers.push(await newParticipant(browser, room, n))
  const sharer = peers[0]
  await fakeScreenShare(sharer.page, 1600, 900)
  await sharer.page.reload()
  await inCall(sharer.page)
  await startScreenShare(sharer.page)
  await page.waitForTimeout(4000)
  await revealChrome(page)
  await page.screenshot({ path: `${OUT}/desktop-content.png` })
  await Promise.all(peers.map((p) => p.context.close()))
})

test('mobile layouts', async ({ page, browser }) => {
  test.skip(!test.info().project.name.startsWith('mobile'))
  const tag = test.info().project.name
  const room = uniqueRoom()
  await join(page, room, 'Bismark')
  await inCall(page)
  const peers = []
  for (const n of ['Ama', 'Kofi', 'Yaw', 'Abena', 'Kojo', 'Esi', 'Nana']) {
    peers.push(await newParticipant(browser, room, n))
  }
  await page.waitForTimeout(4000)
  await revealChrome(page)
  await page.screenshot({ path: `${OUT}/${tag}-speaker.png` })

  await page.getByRole('button', { name: /^View: / }).tap()
  await page.screenshot({ path: `${OUT}/${tag}-view-menu.png` })
  await page.getByRole('menuitem', { name: 'Gallery' }).tap()
  await page.waitForTimeout(2000)
  await revealChrome(page)
  await page.screenshot({ path: `${OUT}/${tag}-gallery.png` })

  await page.getByRole('group', { name: /^Your video/ }).tap()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${tag}-self-expanded.png` })

  await Promise.all(peers.map((p) => p.context.close()))
})

test('mobile content share', async ({ page, browser }) => {
  test.skip(!test.info().project.name.startsWith('mobile'))
  const tag = test.info().project.name
  const room = uniqueRoom()
  await join(page, room, 'Bismark')
  await inCall(page)
  const peers = []
  for (const n of ['Ama', 'Kofi', 'Yaw']) peers.push(await newParticipant(browser, room, n))
  const sharer = peers[0]
  await fakeScreenShare(sharer.page, 1600, 900)
  await sharer.page.reload()
  await inCall(sharer.page)
  await startScreenShare(sharer.page)
  await page.waitForTimeout(4000)
  await revealChrome(page)
  await page.screenshot({ path: `${OUT}/${tag}-content.png` })
  await Promise.all(peers.map((p) => p.context.close()))
})
