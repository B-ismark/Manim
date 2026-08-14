/*
 * S-d spike (docs/low-bandwidth-plan.md §3b): is a downscaled WebP frame really
 * ~6 KB? This gates F-1 "slideshow video" — audio plus one still every few seconds
 * over the existing lossy data channel, as a tier below full video.
 *
 * Pure local compute: Chromium canvas + toBlob('image/webp'). No network, no
 * LiveKit, no production code touched.
 *
 * HONEST LIMITATION, stated up front: there are no real webcam frames here, and a
 * real camera image is harder to compress than anything synthetic — sensor noise,
 * skin texture and cloth weave all cost bits that a clean gradient does not. So
 * this does not produce "the" number. It brackets it: several content types
 * spanning smooth to pure noise, where pure noise is a hard worst case no camera
 * can exceed. If the budget holds even there, the conclusion survives whatever a
 * real face turns out to cost.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><meta charset=utf-8><title>webp</title>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// PW_CHROMIUM lets a sandbox point at a preinstalled binary; normally omit it.
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
})
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/`)

const results = await page.evaluate(async () => {
  // Deterministic PRNG so the numbers are reproducible run to run.
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  function draw(kind, w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')

    // Background gradient — stands in for a wall/room behind the subject.
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#5b6b7a')
    grad.addColorStop(1, '#2b3540')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)

    if (kind === 'smooth') return c

    if (kind === 'portrait' || kind === 'portrait-noisy') {
      // Head + shoulders, roughly where a webcam would put them.
      g.fillStyle = '#c98f6a'
      g.beginPath()
      g.ellipse(w / 2, h * 0.42, w * 0.17, h * 0.23, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#3a4a5a'
      g.beginPath()
      g.ellipse(w / 2, h * 1.02, w * 0.38, h * 0.34, 0, 0, Math.PI * 2)
      g.fill()
      // Eyes / mouth — small high-contrast detail, which is what actually costs bits.
      g.fillStyle = '#20242a'
      g.fillRect(w * 0.44, h * 0.38, w * 0.035, h * 0.025)
      g.fillRect(w * 0.53, h * 0.38, w * 0.035, h * 0.025)
      g.fillRect(w * 0.47, h * 0.52, w * 0.06, h * 0.015)
      if (kind === 'portrait') return c
    }

    // Per-pixel noise. 'portrait-noisy' adds low-amplitude grain to approximate
    // real sensor noise; 'noise' replaces everything with full-amplitude random,
    // which is the incompressible worst case.
    const img = g.getImageData(0, 0, w, h)
    const d = img.data
    const amp = kind === 'noise' ? 255 : 18
    for (let i = 0; i < d.length; i += 4) {
      if (kind === 'noise') {
        d[i] = rnd() * amp
        d[i + 1] = rnd() * amp
        d[i + 2] = rnd() * amp
      } else {
        const n = (rnd() - 0.5) * amp
        d[i] = Math.max(0, Math.min(255, d[i] + n))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
      }
    }
    g.putImageData(img, 0, 0)
    return c
  }

  const encode = (canvas, quality) =>
    new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ? b.size : -1), 'image/webp', quality),
    )

  const out = []
  for (const [w, h] of [[160, 120], [192, 144], [240, 180]]) {
    for (const kind of ['smooth', 'portrait', 'portrait-noisy', 'noise']) {
      const canvas = draw(kind, w, h)
      for (const q of [0.3, 0.5, 0.7]) {
        out.push({ size: `${w}x${h}`, kind, quality: q, bytes: await encode(canvas, q) })
      }
    }
  }
  return out
})

await browser.close()
server.close()

// kbps for one frame every N seconds.
const kbps = (bytes, everySec) => ((bytes * 8) / 1000 / everySec).toFixed(1)

console.log('bytes per frame, and the sustained bitrate at 1 frame / 3s / 4s / 5s\n')
console.log('size      content          q     bytes    @3s     @4s     @5s')
for (const r of results) {
  console.log(
    `${r.size.padEnd(9)} ${r.kind.padEnd(16)} ${r.quality}  ${String(r.bytes).padStart(6)}  ` +
      `${kbps(r.bytes, 3).padStart(6)}  ${kbps(r.bytes, 4).padStart(6)}  ${kbps(r.bytes, 5).padStart(6)}  kbps`,
  )
}
