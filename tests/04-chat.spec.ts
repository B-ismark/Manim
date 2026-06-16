import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join, openChat } from './helpers'

test.describe('Chat', () => {
  test('send a message; it renders and the composer clears', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('hello world')
    await composer.press('Enter')
    await expect(page.getByText('hello world')).toBeVisible()
    await expect(composer).toHaveValue('')
    expect(appErrors(sink)).toEqual([])
  })

  test('markdown renders as formatting (and is XSS-safe)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('**bold** _italic_ `code` ~~strike~~')
    await composer.press('Enter')
    const row = page.locator('p', { hasText: 'bold' }).last()
    await expect(row.locator('strong')).toHaveText('bold')
    await expect(row.locator('em')).toHaveText('italic')
    await expect(row.locator('code')).toHaveText('code')
    await expect(row.locator('s')).toHaveText('strike')

    // XSS: an <img onerror> payload must render as literal text, not an element.
    await composer.fill('<img src=x onerror="window.__xss=1">')
    await composer.press('Enter')
    await expect(page.getByText('<img src=x onerror=')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('own message can be edited; (edited) marker appears', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('first draft')
    await composer.press('Enter')
    const row = page.locator('.group', { hasText: 'first draft' }).first()
    await row.hover()
    await row.getByRole('button', { name: 'Edit message' }).click()
    const editor = page.getByRole('textbox', { name: 'Edit message' })
    await editor.fill('edited text')
    await editor.press('Enter')
    await expect(page.getByText('edited text')).toBeVisible()
    await expect(page.getByText('(edited)')).toBeVisible()
  })

  test('emoji reaction can be added to a message', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('react to me')
    await composer.press('Enter')
    const row = page.locator('.group', { hasText: 'react to me' }).first()
    await row.hover()
    await row.getByRole('button', { name: 'Add reaction' }).click()
    // Emoji picker: search narrows to a known emoji, then pick it by accessible name.
    const search = page.getByRole('textbox', { name: 'Search emoji' })
    await expect(search).toBeVisible()
    await search.fill('grinning')
    const emoji = page.getByRole('button', { name: /grinning/i }).first()
    await emoji.click()
    // A reaction chip (aria-pressed because it's mine) appears under the message.
    await expect(row.locator('button[aria-pressed="true"]').first()).toBeVisible()
  })

  test('chat flood: 60 rapid messages stay responsive', async ({ page }) => {
    const sink = attachErrorSink(page)
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    const N = 60
    for (let i = 0; i < N; i++) {
      await composer.fill(`flood-${i}`)
      await composer.press('Enter')
    }
    // Last message is rendered and composer still works.
    await expect(page.getByText(`flood-${N - 1}`)).toBeVisible({ timeout: 20_000 })
    await composer.fill('still alive')
    await composer.press('Enter')
    await expect(page.getByText('still alive')).toBeVisible()
    expect(appErrors(sink), appErrors(sink).join('\n')).toEqual([])
  })
})
