import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join, openChat, openMessageActions, replyToMessage, isTouch } from './helpers'

test.describe('Chat', () => {
  /**
   * Where the hover toolbar sits decides whether you can read the message you are
   * about to act on. It used to sit at the row's top-right, which is fine on an
   * UNGROUPED row — that aligns with the short name+time header — but a grouped
   * row has no header, so the bar landed on the first line of the text. Measured
   * at the panel's real width: a 116px bar against 83px of clearance ate the last
   * word the moment the pointer arrived.
   *
   * Two messages in a row from the same author is all it takes to group.
   */
  test('the hover actions never cover the message they act on', async ({ page }) => {
    test.skip(await isTouch(page), 'the hover toolbar is desktop-only; touch uses a popover')
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('First line, short.')
    await composer.press('Enter')
    await composer.fill('A second line, deliberately long enough to run to the right edge.')
    await composer.press('Enter')

    const grouped = page.locator('[data-mid]').last()
    await expect(grouped).toBeVisible()
    await grouped.hover()

    // Real 2D intersection of the toolbar with the first rendered line of text —
    // not a width heuristic, which would miss the vertical move entirely.
    const covered = await grouped.evaluate((row) => {
      const bar = row.querySelector(':scope > div.absolute')
      const el = [...row.querySelectorAll('p, span')].filter((n) => (n.textContent || '').length > 8).pop()
      const tn = el && [...el.childNodes].find((n) => n.nodeType === 3)
      if (!bar || !tn) return null
      const rg = document.createRange()
      rg.selectNodeContents(tn)
      const line = [...rg.getClientRects()][0]
      const b = bar.getBoundingClientRect()
      if (!line) return null
      return !(b.right <= line.left || b.left >= line.right || b.bottom <= line.top || b.top >= line.bottom)
    })
    expect(covered, 'the action bar must not overlap the text of its own message').toBe(false)

    // Floating it clear of the text is only half the fix — it still has to be
    // reachable. Scoped to THIS row: unscoped, the other row's (invisible) bar
    // matches too, and this one legitimately covers it.
    await grouped.getByRole('button', { name: /^Reply$/i }).click()
    await expect(page.getByRole('button', { name: /Cancel reply/i })).toBeVisible()
  })

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
    await openMessageActions(page, row)
    await page.getByRole('button', { name: 'Edit message' }).click()
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
    await openMessageActions(page, row)
    await page.getByRole('button', { name: 'Add reaction' }).click()
    // Emoji picker: search narrows to a known emoji, then pick it by accessible name.
    const search = page.getByRole('textbox', { name: 'Search emoji' })
    await expect(search).toBeVisible()
    await search.fill('grinning')
    const emoji = page.getByRole('button', { name: /grinning/i }).first()
    await emoji.click()
    // A reaction chip (aria-pressed because it's mine) appears under the message.
    await expect(row.locator('button[aria-pressed="true"]').first()).toBeVisible()
  })

  test('reply to a message quotes it (swipe on touch, toolbar on desktop)', async ({ page }) => {
    await join(page, uniqueRoom(), 'Ada')
    const composer = await openChat(page)
    await composer.fill('quote me')
    await composer.press('Enter')
    const row = page.locator('.group', { hasText: 'quote me' }).first()
    await replyToMessage(page, row)
    // The composer shows a "Replying to You" chip while the reply is staged.
    await expect(page.getByText('Replying to You')).toBeVisible()
    await composer.fill('here is the reply')
    await composer.press('Enter')
    // The sent message renders with a quoted card pointing back at the original.
    const reply = page.locator('.group', { hasText: 'here is the reply' }).first()
    await expect(reply.getByText('quote me')).toBeVisible()
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
