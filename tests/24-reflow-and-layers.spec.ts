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
  // Every width from the narrow layout to the full one keeps the bar on screen,
  // either side of the switch.
  for (const w of [480, 679, 680, 720, 1024]) {
    await page.setViewportSize({ width: w, height: 700 })
    await expect(bar.getByRole('button', { name: 'Leave call' })).toBeVisible()
    const r = await bar.evaluate((el) => el.getBoundingClientRect().toJSON())
    expect(r.left, `bar left edge at ${w}px`).toBeGreaterThanOrEqual(0)
    expect(r.right, `bar right edge at ${w}px`).toBeLessThanOrEqual(w)
  }
  // Wide again: the full bar is back.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(bar.getByRole('button', { name: /^Reactions and raise hand/ })).toBeVisible()
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
  // An action that moves focus keeps it: Edit's field must not lose focus to the
  // closing menu (on a phone that closes the keyboard).
  await page.getByRole('button', { name: 'Edit message' }).click()
  const editor = page.getByRole('textbox', { name: /edit/i })
  await expect(editor).toBeFocused()
  await page.waitForTimeout(300)
  await expect(editor).toBeFocused()
})

test('a narrowing desktop window folds the bar one control at a time, lowest priority first', async ({ page }) => {
  test.skip(await isTouch(page), 'the touch bar never folds')
  await join(page, uniqueRoom('fold'), 'Ama')
  const bar = page.getByRole('region', { name: 'Call controls' })
  const react = bar.getByRole('button', { name: /^Reactions and raise hand/ })
  const share = bar.getByRole('button', { name: 'Share screen' })
  const caret = bar.getByRole('button', { name: 'Audio options' })

  await page.setViewportSize({ width: 1024, height: 700 })
  await expect(react).toBeVisible()

  // Shrink a step at a time. Whatever folds, it folds in order: reactions go
  // before Share, and Share before the device carets — never several at once
  // the way the old 680px cliff did it.
  const seen: string[] = []
  for (let w = 700; w >= 320; w -= 10) {
    await page.setViewportSize({ width: w, height: 700 })
    await expect(bar.getByRole('button', { name: 'Leave call' })).toBeVisible()
    const r = await bar.evaluate((el) => el.getBoundingClientRect().toJSON())
    expect(r.right, `bar right edge at ${w}px`).toBeLessThanOrEqual(w)
    const state = `${await react.count()}${await share.count()}${await caret.count()}`
    if (seen.at(-1) !== state) seen.push(state)
  }
  // 1 = on the bar. Full → reactions folded → Share folded → carets folded.
  expect(seen).toEqual(['111', '011', '001', '000'])

  // Folded reactions are a row in More.
  await bar.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('button', { name: 'React 👍' })).toBeVisible()
})
