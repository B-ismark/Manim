// Standalone responsive / overlap / perf audit for surfaces that render without
// LiveKit creds (landing + prejoin). Run while `npm run dev:web` is up:
//   node audit/responsive-audit.mjs
// Emits audit/responsive-audit.json + screenshots under audit/shots/.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const SHOTS = 'audit/shots'
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
  { name: 'xs-320', w: 320, h: 568 },
  { name: 'mobile-360', w: 360, h: 740 },
  { name: 'iphone-390', w: 390, h: 844 },
  { name: 'phablet-430', w: 430, h: 932 },
  { name: 'tablet-768', w: 768, h: 1024 },
  { name: 'ipad-820', w: 820, h: 1180 },
  { name: 'land-1024', w: 1024, h: 768 },
  { name: 'laptop-1280', w: 1280, h: 800 },
  { name: 'desk-1440', w: 1440, h: 900 },
  { name: 'wide-1920', w: 1920, h: 1080 },
]

const ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'prejoin', path: '/r/audit-room' },
]

// Find pairs of visible interactive/text leaf elements whose boxes overlap while
// neither is an ancestor of the other (true visual collisions, not nesting).
const OVERLAP_FN = () => {
  const sel = 'button, a, input, select, textarea, [role="button"], [role="dialog"] h1, [role="dialog"] h2, label'
  const els = [...document.querySelectorAll(sel)].filter((e) => {
    const r = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  })
  const rect = (e) => e.getBoundingClientRect()
  const related = (a, b) => a.contains(b) || b.contains(a)
  const overlaps = []
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j]
      if (related(a, b)) continue
      const ra = rect(a), rb = rect(b)
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left))
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top))
      const area = ix * iy
      if (area <= 1) continue
      const minArea = Math.min(ra.width * ra.height, rb.width * rb.height)
      const frac = area / minArea
      if (frac > 0.15) {
        const desc = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${(e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : '')}[${(e.textContent || '').trim().slice(0, 24)}]`
        overlaps.push({ a: desc(a), b: desc(b), frac: Math.round(frac * 100) / 100 })
      }
    }
  }
  // De-dup identical pairs.
  const seen = new Set()
  return overlaps.filter((o) => {
    const k = o.a + '|' + o.b
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const OVERFLOW_FN = () => ({
  docW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
})

const run = async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const results = []
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        permissions: ['camera', 'microphone'],
        deviceScaleFactor: 1,
      })
      const page = await ctx.newPage()
      const consoleErrors = []
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
      page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message.slice(0, 160)))
      const t0 = Date.now()
      await page.goto(BASE + route.path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(700) // settle layout / fonts / camera tile
      const loadMs = Date.now() - t0
      const overlaps = await page.evaluate(OVERLAP_FN)
      const overflow = await page.evaluate(OVERFLOW_FN)
      await page.screenshot({ path: `${SHOTS}/${route.name}-${vp.name}.png`, fullPage: false })
      results.push({
        route: route.name, viewport: vp.name, size: `${vp.w}x${vp.h}`, loadMs,
        horizontalOverflow: overflow.horizontalOverflow,
        overlapCount: overlaps.length, overlaps: overlaps.slice(0, 8),
        consoleErrors: consoleErrors.filter((e) => !/favicon|ResizeObserver|giphy|net::ERR_|40[34]/i.test(e)),
      })
      await ctx.close()
    }
  }

  // Graceful-resize probe on prejoin: shrink in steps, flag any width that introduces overflow.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] })
  const page = await ctx.newPage()
  await page.goto(BASE + '/r/audit-room', { waitUntil: 'networkidle' })
  const resizeFindings = []
  for (let w = 1440; w >= 320; w -= 40) {
    await page.setViewportSize({ width: w, height: 860 })
    await page.waitForTimeout(120)
    const o = await page.evaluate(OVERFLOW_FN)
    if (o.horizontalOverflow > 0) resizeFindings.push({ width: w, overflow: o.horizontalOverflow })
  }
  await ctx.close()
  await browser.close()

  const summary = {
    base: BASE,
    totalChecks: results.length,
    withOverflow: results.filter((r) => r.horizontalOverflow > 0).map((r) => `${r.route}@${r.size} (+${r.horizontalOverflow}px)`),
    withOverlap: results.filter((r) => r.overlapCount > 0).map((r) => `${r.route}@${r.size} (${r.overlapCount})`),
    withErrors: results.filter((r) => r.consoleErrors.length > 0).map((r) => `${r.route}@${r.size}`),
    slowest: [...results].sort((a, b) => b.loadMs - a.loadMs).slice(0, 5).map((r) => `${r.route}@${r.size}: ${r.loadMs}ms`),
    resizeOverflowWidths: resizeFindings,
    results,
  }
  writeFileSync('audit/responsive-audit.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2))
}

run().catch((e) => { console.error(e); process.exit(1) })
