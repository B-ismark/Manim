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

/** Force the colour scheme so a11y / visual runs cover BOTH themes. The app's
 *  default mode is 'system', so emulating the media query drives applyTheme()
 *  (which swaps the baseLight/baseDark token sets on <html>). */
export async function setColorScheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme })
}

/** Run axe against the current page and return only the violations, each trimmed
 *  to what's actionable. Excludes live <video> (pixels aren't analysable). */
export async function axeViolations(page: Page) {
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('video')
    .analyze()
  return res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, html: n.html.slice(0, 120) })),
  }))
}

/** In-page health snapshot for stress/visual runs: tile count, decoding videos,
 *  rough JS heap (Chromium-only). Best-effort. */
export async function pageMetrics(page: Page) {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'))
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return {
      tiles: document.querySelectorAll('[class*="rounded-tile"]').length,
      videos: videos.length,
      decoding: videos.filter((v) => v.videoWidth > 0 && !v.paused).length,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    }
  })
}

/** Detect visually-colliding interactive elements (true overlaps, not nesting). */
export async function overlaps(page: Page) {
  return page.evaluate(() => {
    const sel = 'button, a, input, select, textarea, [role="button"]'
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => {
      const r = e.getBoundingClientRect()
      const s = getComputedStyle(e)
      return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && Number(s.opacity) > 0.05
    })
    const out: { a: string; b: string; frac: number }[] = []
    const desc = (e: HTMLElement) =>
      `${e.tagName.toLowerCase()}[${(e.textContent || '').trim().slice(0, 20)}]`
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j]
        if (a.contains(b) || b.contains(a)) continue
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
        const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left))
        const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top))
        const area = ix * iy
        if (area <= 1) continue
        const frac = area / Math.min(ra.width * ra.height, rb.width * rb.height)
        if (frac > 0.2) out.push({ a: desc(a), b: desc(b), frac: Math.round(frac * 100) / 100 })
      }
    }
    return out
  })
}

/** CDP network throttle (Chromium only) to exercise reconnect / adaptive-quality.
 *  Pass null to restore. */
export async function throttleNetwork(page: Page, profile: '3g' | 'offline' | null) {
  const client = await page.context().newCDPSession(page)
  if (profile === null) {
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    return
  }
  const presets = {
    '3g': { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
    offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  }
  await client.send('Network.emulateNetworkConditions', presets[profile])
}
