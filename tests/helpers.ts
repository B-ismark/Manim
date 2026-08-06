import { type Page, type Locator, type BrowserContext, type Browser, expect } from '@playwright/test'

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

/** Truly environmental noise — third-party / browser chrome, never an app bug.
 *  Always filtered, even in strict mode. */
const ENV_NOISE_RE =
  /favicon|ResizeObserver|giphy|Failed to load resource.*40[34]|abort handler called/i

/** Transient connection / media-pipeline errors that LiveKit emits during normal
 *  teardown (leave) and on the unhappy paths we DON'T assert in a given spec. These
 *  are tolerated by default so happy-path specs aren't flaked by leave-time noise —
 *  but they're exactly the symptoms of the resilience / E2EE bugs (T5 in the audit),
 *  so a spec that targets those paths must pass { strict: true } to surface them. */
const TRANSIENT_CONN_RE =
  /net::ERR_|datachannel|publishing rejected|insertable streams|the user aborted a request|ConnectionError/i

/**
 * Are we pointed at a LiveKit running on this machine?
 *
 * Matters because a `livekit-server --dev` is not a small LiveKit Cloud — some
 * behaviour simply is not there to test, and pretending otherwise produces
 * failures that say nothing about this app.
 */
export const usingLocalLiveKit = /^(ws|http)s?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
  process.env.LIVEKIT_URL ?? '',
)

/**
 * The Krisp noise filter is a LiveKit CLOUD entitlement. Against a local dev
 * server it cannot authenticate and fails with "Could not authenticate. Server
 * responded with status 404" — a property of the backend under test, not a fault
 * in this app, and the reason three specs asserting a clean error sink failed the
 * first time CI ran the suite against a local server.
 *
 * Tolerated ONLY when local. Against Cloud the filter is supposed to work, so a
 * Krisp failure there is real and must still fail the sink.
 *
 * Two entries reach the sink per failure and only one of them names Krisp: the
 * reported one carries the stack (`…@livekit_krisp-noise-filter.js`), while the
 * bare console error is just the message. Matching only the module name caught
 * the first and let the second through — which is why this passed locally, where
 * the failure reads "Failed to fetch" WITH a Krisp stack, and still failed in CI,
 * where it reads "Could not authenticate…" with none.
 */
const CLOUD_ONLY_RE =
  /krisp|noise[- ]?filter|could not authenticate\. server responded with status 404/i

/**
 * App-originated errors from the sink, with noise filtered.
 * - default: tolerate transient connection/media errors (happy-path specs).
 * - { strict: true }: only filter true environmental noise, so connection / E2EE /
 *   datachannel failures fail the test instead of being silently swallowed.
 */
export function appErrors(sink: ErrorSink, opts: { strict?: boolean } = {}): string[] {
  const all = [...sink.pageErrors, ...sink.consoleErrors].filter(
    (e) => !(usingLocalLiveKit && CLOUD_ONLY_RE.test(e)),
  )
  if (opts.strict) return all.filter((e) => !ENV_NOISE_RE.test(e))
  return all.filter((e) => !ENV_NOISE_RE.test(e) && !TRANSIENT_CONN_RE.test(e))
}

/**
 * Close an auxiliary browser context, tolerating Playwright's trace writer
 * racing the close.
 *
 * With `trace: 'retain-on-failure'` every context writes a trace zip. A spec that
 * runs three contexts on a 2-core CI runner can still be flushing that zip when
 * close() lands, and close() then throws "file data stream has unexpected number
 * of bytes" / "End of central directory record signature not found". Every
 * assertion in the test has already passed at that point: the failure is the
 * recorder, not the product. It is exactly why 17-annotate's share-cap spec
 * passed one CI run and failed the next on the identical commit.
 *
 * Scoped on purpose — only those two messages are swallowed. Anything else
 * propagates, so a context that genuinely fails to close still fails the test.
 */
export async function closeContext(context: BrowserContext): Promise<void> {
  try {
    await context.close()
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    if (!/unexpected number of bytes|end of central directory record/i.test(msg)) throw err
  }
}

/** Fill prejoin and enter the call. Returns once in-call chrome (mic button) is visible.
 *  `hash` carries room secrets (#k=…&e=…) — pass an E2EE key (`#e=…`) to exercise the
 *  encrypted path. */
export async function join(page: Page, room: string, name: string, hash = ''): Promise<void> {
  await page.goto(`/r/${room}${hash}`, { waitUntil: 'domcontentloaded' })
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
  hash = '',
): Promise<{ context: BrowserContext; page: Page; sink: ErrorSink }> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  const sink = attachErrorSink(page)
  await join(page, room, name, hash)
  return { context, page, sink }
}

/** Force getUserMedia + the Permissions API to report a hard DENY for this page,
 *  regardless of the browser-level fake-media flag (which would otherwise auto-grant).
 *  Must run BEFORE navigation (addInitScript). Mirrors a user who blocked the camera. */
export async function denyMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const err = () => {
      const e = new Error('Permission denied')
      e.name = 'NotAllowedError'
      return Promise.reject(e)
    }
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = err as typeof navigator.mediaDevices.getUserMedia
    }
    if (navigator.permissions) {
      navigator.permissions.query = (() =>
        Promise.resolve({
          state: 'denied',
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent: () => false,
        })) as typeof navigator.permissions.query
    }
  })
}

/** Is this a touch device? (mobile project) — gates real tap gestures. */
export async function isTouch(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(pointer: coarse)').matches)
}

/** Wake the auto-hiding control chrome on touch — exactly as a user would: a real
 *  finger TAP on the top scrim (above the tiles, so it never hits a tile's
 *  pin/double-tap). No keyboard, no hover. No-op on desktop (controls always
 *  shown), and only taps when the control bar is actually off-viewport. */
export async function revealChrome(page: Page) {
  const vp = page.viewportSize()
  if (!vp || !(await isTouch(page))) return
  const box = await page.getByRole('button', { name: 'Leave call' }).boundingBox().catch(() => null)
  const hidden = !box || box.y > vp.height - 4
  if (hidden) {
    await page.touchscreen.tap(Math.round(vp.width / 2), 4)
    await page.waitForTimeout(300)
  }
}

/** Close any open Sheet (chat / participants / More) the way a real user does:
 *  TAP the "Close panel" X in the header. No Escape — phones have no Esc key. */
export async function closePanel(page: Page) {
  const x = page.getByRole('button', { name: 'Close panel' }).last()
  if (await x.isVisible().catch(() => false)) await x.click()
}

/** Open the chat side panel and return the message composer. */
export async function openChat(page: Page) {
  await revealChrome(page)
  await page.getByRole('button', { name: 'Open chat' }).click()
  // The composer is an ARIA combobox (it hosts the @-mention autocomplete).
  const composer = page.getByRole('combobox', { name: 'Message', exact: true })
  await expect(composer).toBeVisible()
  return composer
}

/** Reveal a message's secondary actions (react / edit / pin), matching the real
 *  per-platform affordance: hover on desktop, long-press on touch (which opens the
 *  anchored actions popover). After this resolves the action buttons — "Add
 *  reaction" / "Edit message" / "Pin" — are in the DOM and clickable at page level.
 *  Reply lives on the swipe gesture on touch, so it's not in this popover. */
export async function openMessageActions(page: Page, row: Locator): Promise<void> {
  if (await isTouch(page)) {
    const box = await row.boundingBox()
    if (!box) throw new Error('openMessageActions: row has no bounding box')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    // Real long-press: pointer down, hold past the 500ms timer, release in place.
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
  } else {
    await row.hover()
  }
}

/** Swipe a message bubble left to reply (touch only). No-op on desktop (which uses
 *  the hover toolbar's Reply button instead). */
export async function swipeToReply(page: Page, row: Locator): Promise<void> {
  if (!(await isTouch(page))) return
  const box = await row.boundingBox()
  if (!box) throw new Error('swipeToReply: row has no bounding box')
  const y = box.y + box.height / 2
  const startX = box.x + box.width - 12
  await page.mouse.move(startX, y)
  await page.mouse.down()
  // Move past SWIPE_TRIGGER (48px) in steps so the move handler arms the swipe.
  await page.mouse.move(startX - 30, y, { steps: 4 })
  await page.mouse.move(startX - 70, y, { steps: 4 })
  await page.mouse.up()
}

/** Start a reply to a message, per platform: swipe-left on touch, the hover
 *  toolbar's Reply button on desktop. Leaves the "Replying to …" chip showing. */
export async function replyToMessage(page: Page, row: Locator): Promise<void> {
  if (await isTouch(page)) {
    await swipeToReply(page, row)
  } else {
    await row.hover()
    await row.getByRole('button', { name: 'Reply', exact: true }).click()
  }
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

/** Detect visually-colliding interactive elements (true overlaps, not nesting).
 *  Parks the mouse first so hover-revealed tile controls (pin/mute/flip, which
 *  stack by design) retract — we measure the resting layout, not a hover state. */
export async function overlaps(page: Page) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400) // > --dur-base (220ms) so hover controls fully fade out
  return page.evaluate(() => {
    const sel = 'button, a, input, select, textarea, [role="button"]'
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => {
      const r = e.getBoundingClientRect()
      if (r.width <= 4 || r.height <= 4) return false
      // checkVisibility walks ANCESTORS — so a button inside an opacity-0 / hidden
      // container (closed effects carousel, retracted hover controls) is correctly
      // treated as invisible. Element-only opacity checks missed those.
      return e.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      } as CheckVisibilityOptions)
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

/**
 * Make `getDisplayMedia` return a synthetic screen-share stream of a KNOWN size.
 *
 * Headless Chromium can't pick a real desktop capture source, and the flags that
 * fake one give you a stream whose dimensions depend on the environment. Anything
 * verifying share geometry needs the intrinsic size to be fixed and known, so we
 * substitute a canvas capture instead: a real MediaStreamTrack, published through
 * LiveKit like any other, but exactly `width`x`height` on every machine.
 *
 * The canvas is animated because a fully static capture stream can stop producing
 * frames, and LiveKit needs frames to keep the track live.
 *
 * `surface` stamps `getSettings().displaySurface`, which the app reads to decide
 * whether echoing your own share back to you is safe (a whole monitor contains this
 * window, so the echo recurses; a window or tab cannot). A canvas capture reports
 * NOTHING for that field, so without this every test here would silently exercise
 * the 'unknown' fallback and the monitor branch would ship untested. Left undefined
 * by default precisely so it keeps reporting nothing — that is a real case too
 * (Firefox, and any synthetic capture), and it deserves coverage as much as the
 * others do.
 *
 * Must run BEFORE navigation (addInitScript).
 */
export async function fakeScreenShare(
  page: Page,
  width = 1280,
  height = 720,
  fps = 10,
  surface?: 'monitor' | 'window' | 'browser',
): Promise<void> {
  await page.addInitScript(
    ({ w, h, f, surface: s }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      let tick = 0
      const paint = () => {
        // A recognisable, non-uniform frame: light field + a moving marker.
        ctx.fillStyle = '#e8e8ee'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#333'
        ctx.fillRect((tick * 7) % w, h / 2, 40, 40)
        tick++
      }
      paint()
      setInterval(paint, Math.round(1000 / f))
      const stream = canvas.captureStream(f)
      if (s) {
        // Wrap rather than replace: the app reads width/height off the same object
        // to size the share, so the real settings have to survive.
        const track = stream.getVideoTracks()[0]
        const original = track.getSettings.bind(track)
        track.getSettings = () => ({ ...original(), displaySurface: s })
      }
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        configurable: true,
        writable: true,
        value: async () => stream,
      })
    },
    { w: width, h: height, f: fps, surface },
  )
}

/** Start screen sharing from the control bar and wait for the presentation layout. */
export async function startScreenShare(page: Page): Promise<void> {
  await revealChrome(page)
  await page.getByRole('button', { name: /^Share screen$/i }).click()
  await expect(page.getByRole('button', { name: /^Stop screen share$/i })).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * Bounding box of drawn ink on an annotation canvas, in UNIT coordinates relative
 * to the video's content box — the same space strokes travel in. Returns null if
 * the canvas is blank.
 *
 * Normalising here (rather than comparing raw pixels) is the whole point: two
 * participants on different viewport sizes must agree in unit space even though
 * their pixel coordinates differ completely.
 */
export async function inkBoundsUnit(
  page: Page,
  aspect: number,
): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  return page.evaluate((a) => {
    const canvas = document.querySelector(
      '[data-testid="annotation-canvas"]',
    ) as HTMLCanvasElement | null
    if (!canvas) return null
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (minX === Infinity) return null
    // Content box under object-contain, in BACKING-STORE pixels (canvas.width/height
    // already include the DPR scale, so this stays consistent across devices).
    const boxAspect = width / height
    let cw = width, ch = height, cx = 0, cy = 0
    if (a > boxAspect) { ch = width / a; cy = (height - ch) / 2 }
    else { cw = height * a; cx = (width - cw) / 2 }
    return {
      x0: (minX - cx) / cw, y0: (minY - cy) / ch,
      x1: (maxX - cx) / cw, y1: (maxY - cy) / ch,
    }
  }, aspect)
}


/**
 * Decode health of the largest video on screen (the shared screen, in the
 * presentation layout) sampled over `ms`.
 *
 * Uses getVideoPlaybackQuality rather than WebRTC stats because it measures what
 * the user actually SEES — frames the compositor presented — which is the thing
 * an annotation overlay could plausibly steal budget from.
 */
export async function shareDecodeFps(page: Page, ms: number) {
  return page.evaluate(async (windowMs) => {
    const pick = () =>
      Array.from(document.querySelectorAll('video'))
        .filter((v) => v.videoWidth > 0)
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
    const v = pick()
    if (!v) return null
    const q0 = v.getVideoPlaybackQuality()
    const t0 = performance.now()
    await new Promise((r) => setTimeout(r, windowMs))
    const q1 = v.getVideoPlaybackQuality()
    const t1 = performance.now()
    const secs = (t1 - t0) / 1000
    return {
      fps: (q1.totalVideoFrames - q0.totalVideoFrames) / secs,
      dropped: q1.droppedVideoFrames - q0.droppedVideoFrames,
      width: v.videoWidth,
      height: v.videoHeight,
    }
  }, ms)
}

/** Scribble continuously inside the share's content box for `ms`. */
export async function scribble(page: Page, ms: number, aspect = 16 / 9): Promise<void> {
  const g = await page.evaluate((a) => {
    const el = document.querySelector('[data-testid="annotation-canvas"]') as HTMLCanvasElement
    const r = el.getBoundingClientRect()
    const boxAspect = r.width / r.height
    let cw = r.width, ch = r.height, cx = 0, cy = 0
    if (a > boxAspect) { ch = r.width / a; cy = (r.height - ch) / 2 }
    else { cw = r.height * a; cx = (r.width - cw) / 2 }
    return { left: r.left, top: r.top, cx, cy, cw, ch }
  }, aspect)

  const at = (ux: number, uy: number) => ({
    x: g.left + g.cx + ux * g.cw,
    y: g.top + g.cy + uy * g.ch,
  })
  const deadline = Date.now() + ms
  let i = 0
  const first = at(0.2, 0.5)
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  while (Date.now() < deadline) {
    // A dense zigzag — worst case for point volume and repaint area.
    const ux = 0.2 + 0.6 * ((i % 20) / 20)
    const uy = 0.3 + 0.4 * (((i * 7) % 20) / 20)
    const p = at(ux, uy)
    await page.mouse.move(p.x, p.y)
    i++
  }
  await page.mouse.up()
}
