import { test, expect } from '@playwright/test'
import { isTouch, join, openChat, uniqueRoom } from './helpers'

/**
 * Backlog batch (Sept 2026): the desktop bar at 400% zoom, toasts queueing under
 * TopStack instead of over it, and a screen-reader route to a message's actions
 * on touch.
 */

test('the desktop bar fits a 320px window (400% zoom) and moves the rest into More', async ({ page }) => {
  test.skip(await isTouch(page), 'the touch bar has its own fit test in 11-mobile-fit')
  await join(page, uniqueRoom('reflow'), 'Ama')
  await page.setViewportSize({ width: 320, height: 700 })
  const bar = page.getByRole('region', { name: 'Call controls' })
  await expect(bar.getByRole('button', { name: 'Leave call' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Share screen' })).toHaveCount(0)
  const edges = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, vw: window.innerWidth }
  })
  expect(edges.left).toBeGreaterThanOrEqual(0)
  expect(edges.right).toBeLessThanOrEqual(edges.vw)
  // Every control on the bar is fully on screen.
  for (const b of await bar.getByRole('button').all()) {
    const box = (await b.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
  }
  // What left the bar is in More, host-only End included.
  await bar.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('button', { name: /^Share screen/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End call for everyone' })).toBeVisible()
  await page.keyboard.press('Escape')
  // Wide again: the full bar is back.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(bar.getByRole('button', { name: 'Share screen' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'End call for everyone' })).toBeVisible()
})

test('a toast queues below the top banners instead of printing over them', async ({ page }) => {
  await join(page, uniqueRoom('layers'), 'Ama')
  // Joining alone makes you host, which raises a toast while the status pill is up.
  const toast = page.getByTestId('toasts').getByText('You’re now the host')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  const stack = await page.getByTestId('top-stack').boundingBox()
  const t = await toast.boundingBox()
  expect(stack && t).toBeTruthy()
  if (stack!.height > 0) expect(t!.y).toBeGreaterThanOrEqual(stack!.y + stack!.height)
})

test('on touch, a message’s actions have a real button a screen reader can reach', async ({ page }) => {
  test.skip(!(await isTouch(page)), 'desktop has the hover toolbar')
  await join(page, uniqueRoom('msgbtn'), 'Ama')
  const composer = await openChat(page)
  await composer.fill('hello there')
  await composer.press('Enter')
  const button = page.getByRole('button', { name: 'Message actions, your message' })
  await expect(button).toHaveCount(1)
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Add reaction' })).toBeVisible()
})
