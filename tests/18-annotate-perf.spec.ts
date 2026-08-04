import { test, expect, type Browser } from '@playwright/test'
import {
  uniqueRoom,
  join,
  revealChrome,
  fakeScreenShare,
  startScreenShare,
  shareDecodeFps,
  scribble,
} from './helpers'

/**
 * Does annotation steal frames from the shared screen on a slow machine?
 *
 * The whole engine design — imperative canvas, no React state, an rAF loop that
 * parks when idle — exists to keep the answer no. This measures it rather than
 * asserting it.
 *
 * METHOD. One observer watches a 30fps share while three other viewers scribble
 * continuously. Decode rate on the observer is sampled idle and under load,
 * ALTERNATELY, twice each, and the means compared.
 *
 * Two controls matter. Both phases run with the SAME five browser contexts alive,
 * so the comparison isolates the cost of drawing rather than the cost of five
 * Chromium instances on one machine. And the samples interleave, because a first
 * attempt with a single before/after saw decode climb from 7.2 to 12.5 fps purely
 * from warm-up — drift that would otherwise be mistaken for a result.
 *
 * "Low-end device" is CDP CPU throttling on the observer only. That is a proxy,
 * not a phone: it slows the main thread but not the GPU or the video decoder, so
 * treat the result as a main-thread-contention signal.
 *
 * @heavy + ANNOTATE_PERF=1 — five contexts and minutes of wall clock, so it runs
 * only when asked for.
 */

const SHARE_W = 1280
const SHARE_H = 720
const SHARE_FPS = 30
const CPU_THROTTLE = 4

const DESKTOP = {
  permissions: ['camera', 'microphone'] as const,
  viewport: { width: 1280, height: 800 },
  hasTouch: false,
  isMobile: false,
  deviceScaleFactor: 1,
}

async function viewer(browser: Browser, room: string, name: string) {
  const context = await browser.newContext({ ...DESKTOP, permissions: [...DESKTOP.permissions] })
  const page = await context.newPage()
  await join(page, room, name)
  return { context, page }
}

test.describe('Annotation performance @heavy @annotate', () => {
  // Opt-in, like the loadtest spec. It was previously hidden by the annotation
  // build flag; with the feature on by default, nothing else would keep a 5-context,
  // ~4-minute measurement out of `test:visual`, which also greps @heavy.
  test.skip(!process.env.ANNOTATE_PERF, 'set ANNOTATE_PERF=1 to run the perf measurement')

  test('three people drawing does not starve the share decoder', async ({ page, browser }) => {
    test.setTimeout(240_000)
    const room = uniqueRoom('perf')

    // Presenter publishes a 30fps share so there is headroom to lose.
    const shareCtx = await browser.newContext({
      ...DESKTOP,
      permissions: [...DESKTOP.permissions],
    })
    const presenter = await shareCtx.newPage()
    await fakeScreenShare(presenter, SHARE_W, SHARE_H, SHARE_FPS)
    await join(presenter, room, 'Presenter')
    await startScreenShare(presenter)

    // Three viewers who will draw.
    const drawers = []
    for (const name of ['Bo', 'Cy', 'Dee']) drawers.push(await viewer(browser, room, name))

    // The observer — the machine we care about. Throttled to stand in for a slow
    // device, and it draws nothing itself; it only receives.
    await join(page, room, 'Ada')
    await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 40_000 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

    // Warm-up matters more than it looks. A first attempt sampled idle at 3s and
    // saw decode RISE from 7.2 to 12.5 fps across the run — subscriptions and
    // adaptive quality were still ramping, and that drift completely swamped the
    // effect being measured. So: settle properly, then sample idle and loaded
    // ALTERNATELY and compare means. Paired sampling cancels any remaining drift,
    // which a single before/after cannot.
    await page.waitForTimeout(12_000)

    for (const d of drawers) {
      await revealChrome(d.page)
      await d.page.getByRole('button', { name: /Annotate shared screen/i }).click()
    }

    const idleSamples: number[] = []
    const loadSamples: number[] = []
    for (let round = 0; round < 3; round++) {
      const idle = await shareDecodeFps(page, 4000)
      expect(idle, 'observer is decoding the share').not.toBeNull()
      idleSamples.push(idle!.fps)

      // Strokes fade in ~4s, so the room is genuinely idle again by the next round.
      const [loaded] = await Promise.all([
        shareDecodeFps(page, 4000),
        ...drawers.map((d) => scribble(d.page, 4000)),
      ])
      expect(loaded).not.toBeNull()
      loadSamples.push(loaded!.fps)
      await page.waitForTimeout(5000)
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const idleFps = mean(idleSamples)
    const loadedFps = mean(loadSamples)

    const report = {
      note: 'absolute fps is harness-limited (4 cores, 5 Chromium contexts); the idle-vs-loaded ratio is the signal',
      cpuThrottle: `${CPU_THROTTLE}x on the observer only`,
      sharePublishedFps: SHARE_FPS,
      idleSamples: idleSamples.map((f) => Number(f.toFixed(1))),
      loadSamples: loadSamples.map((f) => Number(f.toFixed(1))),
      idleMeanFps: Number(idleFps.toFixed(1)),
      loadedMeanFps: Number(loadedFps.toFixed(1)),
      retainedUnderLoad: `${Math.round((loadedFps / idleFps) * 100)}%`,
    }
    console.log('ANNOTATE_PERF:', JSON.stringify(report))
    test.info().attach('annotate-perf.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    })

    // Deliberately generous: this shares 4 cores with five Chromium instances, so
    // it is a regression tripwire, not a benchmark. A real problem is a collapse.
    expect(
      loadedFps,
      'the share keeps decoding while three people draw simultaneously',
    ).toBeGreaterThan(idleFps * 0.7)

    for (const d of drawers) await d.context.close()
    await shareCtx.close()
  })
})
