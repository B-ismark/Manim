import { test, expect } from '@playwright/test'
import { attachErrorSink, appErrors } from './helpers'

test.describe('Landing', () => {
  test('renders and Join is gated on a room name', async ({ page }) => {
    const sink = attachErrorSink(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
    const join = page.getByRole('button', { name: 'Join' })
    await expect(join).toBeDisabled()
    await page.locator('#room').fill('my-room')
    await expect(join).toBeEnabled()
    expect(appErrors(sink)).toEqual([])
  })

  test('Join navigates to a slugified room route', async ({ page }) => {
    await page.goto('/')
    await page.locator('#room').fill('Team Standup')
    await page.getByRole('button', { name: 'Join' }).click()
    await expect(page).toHaveURL(/\/r\/team-standup$/)
    // Lands on prejoin.
    await expect(page.getByLabel('Your name')).toBeVisible({ timeout: 20_000 })
  })

  test('New meeting generates a random, secured room when no name is typed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New meeting' }).click()
    // High-entropy slug PLUS a join secret + E2EE key in the #fragment (the link,
    // not the slug, is the credential — see lib/roomLink).
    await expect(page).toHaveURL(/\/r\/[a-z]+-[a-z]+-[a-z0-9]+#k=[^&]+&e=.+$/)
  })

  test('New meeting uses a typed name and still mints link secrets', async ({ page }) => {
    await page.goto('/')
    await page.locator('#room').fill('Design Sync')
    await page.getByRole('button', { name: 'New meeting' }).click()
    await expect(page).toHaveURL(/\/r\/design-sync#k=[^&]+&e=.+$/)
  })

  test('Settings popover opens from landing', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    // Settings is an anchored popover (no scrim), not a modal dialog.
    await expect(page.getByText('Your profile, notifications, and appearance.')).toBeVisible()
  })

  test('unknown route redirects home', async ({ page }) => {
    await page.goto('/totally/unknown/path')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()
  })
})

/**
 * The landing header is `fixed` and transparent, and it stretches `inset-x-4`
 * across the full width with its controls pinned to the two ends. The brand sits
 * in the gap between them — on the short phone with only 8px to spare, because
 * `short:pt-4` pulls the content back up under the header band.
 *
 * Zero tolerance, deliberately: 09-visual's `overlaps()` only reports an
 * intersection above 20% of the smaller element's area, so it would stay silent
 * on exactly the few-pixel collision this margin is one padding change away from.
 */
test('the landing brand never collides with the header controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Manim' })).toBeVisible()

  const geom = await page.evaluate(() => {
    const header = document.querySelector('header')
    const main = document.querySelector('main')
    if (!header || !main) throw new Error('landing header/main not found')
    const rect = (el: Element) => el.getBoundingClientRect()
    const controls = [...header.querySelectorAll('button, a, [role="button"]')]
      .map((el) => ({ label: (el.getAttribute('aria-label') || el.textContent || '?').trim(), r: rect(el) }))
      .filter((c) => c.r.width > 0 && c.r.height > 0)
    // Everything the page itself paints in the header's band, header excluded.
    const subjects = [...main.querySelectorAll('h1, h1 + *, [data-brand]')]
      .filter((el) => !header.contains(el))
      .map((el) => ({ label: (el.textContent || 'brand').trim().slice(0, 24), r: rect(el) }))
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const collisions: string[] = []
    let tightest = Infinity
    for (const s of subjects) {
      for (const c of controls) {
        const vertical = s.r.top < c.r.bottom && s.r.bottom > c.r.top
        if (!vertical) continue // not in the header's band at all; horizontal gap is meaningless
        if (hit(s.r, c.r)) collisions.push(`"${s.label}" overlaps "${c.label}"`)
        else tightest = Math.min(tightest, Math.max(c.r.left - s.r.right, s.r.left - c.r.right))
      }
    }
    return { collisions, tightest, controlCount: controls.length, subjectCount: subjects.length }
  })

  // Guard the guard: if the selectors ever stop matching, this test would pass
  // over an empty list and prove nothing.
  expect(geom.controlCount, 'header controls found').toBeGreaterThan(0)
  expect(geom.subjectCount, 'brand elements found').toBeGreaterThan(0)
  expect(geom.collisions).toEqual([])
})
