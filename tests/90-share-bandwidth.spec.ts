import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test'
import { join, uniqueRoom, startScreenShare } from './helpers'

/**
 * Screen-share bandwidth measurement — @heavy, MANUAL.
 *
 * This is a measurement harness, not a gate. It holds real calls open against a
 * local `livekit-server --dev` and samples RTCPeerConnection stats, so it is far
 * too slow and too noisy for the normal path; `playwright.config` already filters
 * `@heavy` out of every project.
 *
 *   livekit-server --dev --bind 127.0.0.1
 *   LIVEKIT_URL=ws://127.0.0.1:7880 VITE_LIVEKIT_URL=ws://127.0.0.1:7880 npm run dev
 *   LIVEKIT_URL=ws://127.0.0.1:7880 VITE_LIVEKIT_URL=ws://127.0.0.1:7880 \
 *     npm run test:sharebw
 *
 * It exists to answer one question that had never been measured: what a screen
 * share actually costs on each publishing path, and whether the VP8 simulcast
 * ladder added in `roomOptions` does anything. `MAX_CONCURRENT_SHARES`'s comment
 * quotes a budget; this is where that number should come from.
 *
 * READ THIS BEFORE QUOTING THE NUMBERS. The source is a synthetic canvas, not a
 * real desktop. It is deliberately high-entropy — dense text plus per-frame noise,
 * because the `fakeScreenShare` helper's near-flat field compresses to almost
 * nothing and would flatter every configuration equally. It is still not a real
 * screen: treat the figures as a comparison BETWEEN configurations, which is what
 * they are good for, and not as an absolute prediction of production uplink.
 */

const HOLD_MS = Number(process.env.SHAREBW_HOLD_MS ?? 12_000)
const RAMP_MS = Number(process.env.SHAREBW_RAMP_MS ?? 10_000)

/** Dense text + noise: what a real shared screen looks like to an encoder. */
async function highEntropyShare(page: Page, w = 1920, h = 1080) {
  await page.addInitScript(
    ({ w, h }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      let tick = 0
      const paint = () => {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        // Dense monospace text, the dominant content of a real share.
        ctx.fillStyle = '#111'
        ctx.font = '13px monospace'
        for (let y = 16; y < h; y += 16) {
          let line = ''
          for (let x = 0; x < 150; x++) line += String.fromCharCode(33 + ((x * 7 + y + tick) % 90))
          ctx.fillText(line, 8, y)
        }
        // A scrolling band so successive frames are not identical (a static frame
        // would let the encoder drop to almost zero and measure nothing).
        const img = ctx.getImageData(0, (tick * 13) % (h - 100), w, 100)
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (Math.random() * 40) | 0
          img.data[i] = Math.min(255, img.data[i] + n)
        }
        ctx.putImageData(img, 0, (tick * 13) % (h - 100))
        tick++
      }
      paint()
      setInterval(paint, 66) // ~15fps source
      const stream = canvas.captureStream(15)
      // @ts-expect-error test double
      navigator.mediaDevices.getDisplayMedia = async () => {
        const t = stream.getVideoTracks()[0]
        // The app branches on displaySurface; claim a monitor.
        t.getSettings = () => ({ width: w, height: h, displaySurface: 'monitor' }) as never
        return stream
      }
    },
    { w, h },
  )
}

/** Keep every RTCPeerConnection reachable so getStats() can be read from the test. */
async function trackPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const Orig = window.RTCPeerConnection
    const all: RTCPeerConnection[] = []
    // @ts-expect-error test double
    window.__pcs = all
    // @ts-expect-error test double
    window.RTCPeerConnection = class extends Orig {
      constructor(...args: unknown[]) {
        // @ts-expect-error passthrough
        super(...args)
        all.push(this as unknown as RTCPeerConnection)
      }
    }
  })
}

interface LayerSample {
  rid: string
  bytes: number
  frames: number
  width: number
  height: number
  fps: number
  scalabilityMode?: string
}

/** Outbound video layers on this page, right now. */
async function videoLayers(page: Page): Promise<LayerSample[]> {
  return page.evaluate(async () => {
    // @ts-expect-error test double
    const pcs: RTCPeerConnection[] = window.__pcs ?? []
    const out: LayerSample[] = []
    for (const pc of pcs) {
      const stats = await pc.getStats()
      stats.forEach((s: Record<string, unknown>) => {
        if (s.type !== 'outbound-rtp' || s.kind !== 'video') return
        out.push({
          rid: (s.rid as string) ?? 'single',
          bytes: (s.bytesSent as number) ?? 0,
          frames: (s.framesSent as number) ?? 0,
          width: (s.frameWidth as number) ?? 0,
          height: (s.frameHeight as number) ?? 0,
          fps: (s.framesPerSecond as number) ?? 0,
          scalabilityMode: s.scalabilityMode as string | undefined,
        })
      })
    }
    return out
  })
}

interface Result {
  label: string
  totalKbps: number
  layers: { rid: string; kbps: number; fps: number; frames: number; res: string; svc?: string }[]
}

async function measure(
  browser: Browser,
  label: string,
  opts: { e2ee?: boolean; lowBandwidth?: boolean },
): Promise<Result> {
  const room = uniqueRoom('bw')
  const hash = opts.e2ee ? '#e=measurementpassphrase' : ''
  const contexts: BrowserContext[] = []
  try {
    // ---- publisher ----
    const pubCtx = await browser.newContext({ permissions: ['camera', 'microphone'] })
    contexts.push(pubCtx)
    const pub = await pubCtx.newPage()
    await highEntropyShare(pub)
    await trackPeerConnections(pub)
    await pub.goto(`/r/${room}${hash}`, { waitUntil: 'domcontentloaded' })
    await expect(pub.getByLabel('Your name')).toBeVisible({ timeout: 20_000 })

    if (opts.lowBandwidth) {
      // Low-bandwidth forces the camera off itself, which is also what makes the
      // outbound video stats unambiguous — the share is then the only video track.
      await pub.getByRole('switch', { name: 'Low-bandwidth' }).click()
    } else {
      await pub.getByRole('button', { name: 'Turn off camera' }).click()
    }
    await pub.getByLabel('Your name').fill('Presenter')
    await pub.getByRole('button', { name: 'Join now' }).click()
    await expect(pub.getByRole('button', { name: /microphone/i }).first()).toBeVisible({
      timeout: 45_000,
    })

    // ---- subscriber (dynacast stops every layer nobody is pulling) ----
    const subCtx = await browser.newContext({ permissions: ['camera', 'microphone'] })
    contexts.push(subCtx)
    const sub = await subCtx.newPage()
    await join(sub, room, 'Viewer', hash)

    // ---- share ----
    // Via the helper, not a raw click: the control bar auto-hides, so the button
    // has to be revealed first.
    await startScreenShare(pub)

    // Let the encoder ramp: BWE starts conservative and climbs.
    await pub.waitForTimeout(RAMP_MS)
    const first = await videoLayers(pub)
    await pub.waitForTimeout(HOLD_MS)
    const second = await videoLayers(pub)

    const byRid = new Map<string, { kbps: number; fps: number; frames: number; res: string; svc?: string }>()
    for (const b of second) {
      const a = first.find((x) => x.rid === b.rid)
      const deltaBytes = b.bytes - (a?.bytes ?? 0)
      const kbps = Math.round((deltaBytes * 8) / (HOLD_MS / 1000) / 1000)
      byRid.set(b.rid, {
        kbps,
        fps: Math.round(b.fps),
        // Cumulative frame delta over the window. `framesPerSecond` is a rolling
        // average that legitimately rounds to 0 at 3fps, so it cannot be used to
        // tell "encoder idle" from "encoder slow".
        frames: b.frames - (a?.frames ?? 0),
        res: `${b.width}x${b.height}`,
        svc: b.scalabilityMode,
      })
    }
    const layers = [...byRid.entries()].map(([rid, v]) => ({ rid, ...v }))
    return { label, totalKbps: layers.reduce((n, l) => n + l.kbps, 0), layers }
  } finally {
    for (const c of contexts) await c.close()
  }
}

function report(r: Result) {
  const lines = [``, `=== ${r.label} ===`, `  total: ${r.totalKbps} kbps`]
  for (const l of r.layers)
    lines.push(
      `    rid=${l.rid.padEnd(8)} ${String(l.kbps).padStart(5)} kbps  ${l.res.padEnd(10)} ${String(l.frames).padStart(4)} frames${l.svc ? `  svc=${l.svc}` : ''}`,
    )
  console.log(lines.join('\n'))

  // A run that published nothing measured nothing — fail rather than report a
  // confident zero. The check is on FRAMES SENT across the window, not on
  // `framesPerSecond`: that is a rolling average which legitimately reads 0 at
  // 3fps, so using it would reject a valid low-bandwidth sample (it did).
  expect(r.layers.length, 'no outbound video layers found').toBeGreaterThan(0)
  expect(r.totalKbps, 'no bytes sent').toBeGreaterThan(0)
  expect(
    r.layers.reduce((n, l) => n + l.frames, 0),
    'no frames sent during the window — the encoder was idle, so this sample is not usable',
  ).toBeGreaterThan(0)
}

/**
 * One scenario per test, deliberately. Run individually to reproduce a result in
 * isolation — four calls back to back on one machine is exactly the CPU
 * contention that produces an idle encoder and a nonsense number.
 */
test.describe('Screen-share bandwidth @heavy', () => {
  test.setTimeout(3 * 60_000)
  test.describe.configure({ mode: 'serial' })

  test('share uplink — open room (VP9 / SVC L1T3)', async ({ browser }) => {
    report(await measure(browser, 'open room (VP9 / SVC L1T3)', {}))
  })

  test('share uplink — E2EE room (VP8 + ladder)', async ({ browser }) => {
    report(await measure(browser, 'E2EE room (VP8 + ladder)', { e2ee: true }))
  })

  test('share uplink — open room + low-bandwidth', async ({ browser }) => {
    report(await measure(browser, 'open room + low-bandwidth', { lowBandwidth: true }))
  })

  test('share uplink — E2EE room + low-bandwidth', async ({ browser }) => {
    report(await measure(browser, 'E2EE room + low-bandwidth', { e2ee: true, lowBandwidth: true }))
  })
})
