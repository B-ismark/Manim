import { type Page, type BrowserContext, type Browser, expect } from '@playwright/test'

/** Unique room per test run so parallel tests + reruns never collide on host/queue state. */
export function uniqueRoom(prefix = 'e2e'): string {
  // No Math.random gating here — Playwright workers run in real Node, Date is fine.
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** Collected page errors + console errors, attached for assertions. */
export interface ErrorSink {
  consoleErrors: string[]
  pageErrors: string[]
}

export function attachErrorSink(page: Page): ErrorSink {
  const sink: ErrorSink = { consoleErrors: [], pageErrors: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') sink.consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => sink.pageErrors.push(e.message))
  return sink
}

/** Noise we tolerate (third-party / environmental, not app bugs). */
const IGNORED_ERROR_RE =
  /favicon|ResizeObserver|giphy|Failed to load resource.*40[34]|net::ERR_|datachannel|publishing rejected|insertable streams|the user aborted a request/i

export function appErrors(sink: ErrorSink): string[] {
  return [...sink.pageErrors, ...sink.consoleErrors].filter((e) => !IGNORED_ERROR_RE.test(e))
}

/** Fill prejoin and enter the call. Returns once in-call chrome (mic button) is visible. */
export async function join(page: Page, room: string, name: string): Promise<void> {
  await page.goto(`/r/${room}`, { waitUntil: 'domcontentloaded' })
  const nameInput = page.getByLabel('Your name')
  await expect(nameInput).toBeVisible({ timeout: 20_000 })
  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Join now' }).click()
  // In-call when the mic toggle (Mute/Unmute microphone) is present.
  await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible({
    timeout: 45_000,
  })
}

/** Spin up a fresh participant in its own context (own camera/mic) and join. */
export async function newParticipant(
  browser: Browser,
  room: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page; sink: ErrorSink }> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  const sink = attachErrorSink(page)
  await join(page, room, name)
  return { context, page, sink }
}

/** Open the chat side panel and return the message composer. */
export async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Open chat' }).click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await expect(composer).toBeVisible()
  return composer
}
