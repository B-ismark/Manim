/*
 * S-a / S-b baseline measurement (docs/low-bandwidth-plan.md §3b).
 *
 * NOT a pass/fail gate. This spec measures and records; the assertions are
 * deliberately minimal (did we connect at all) so a bad network produces DATA
 * rather than a red X. The numbers land in lowbw-report/*.json.
 *
 * It is isolated from the normal suites on purpose — see playwright.lowbw.config.ts
 * and the `testIgnore` in playwright.config.ts. It must never run inside `npm test`:
 * it is slow by design and its whole point is to be run under a network shaper.
 *
 * The shaping itself is applied OUTSIDE this file (tc/netem, in the workflow), for
 * one reason that is easy to get wrong: CDP's Network.emulateNetworkConditions does
 * not touch an established WebRTC media path — the same limitation the app already
 * documents around its fault-simulation seam (RoomView.tsx). Throttling from inside
 * the browser would measure the page load and quietly leave the call at full speed,
 * which is precisely the thing we are trying to measure.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { join, newParticipant, uniqueRoom, closeContext } from '../helpers'
import type { Page } from '@playwright/test'

const PROFILE = process.env.LOWBW_PROFILE ?? 'unshaped'
const HOLD_MS = Number(process.env.LOWBW_HOLD_MS ?? 30_000)
const OUT_DIR = 'lowbw-report'

/**
 * Record every RTCPeerConnection the page creates, so stats can be read without
 * reaching into LiveKit internals (which are not a stable API). Must run before
 * navigation.
 */
async function trackPeerConnections(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pcs?: RTCPeerConnection[] }
    w.__pcs = []
    const Orig = window.RTCPeerConnection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.RTCPeerConnection = function (this: unknown, ...args: any[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pc = new (Orig as any)(...args)
      w.__pcs!.push(pc)
      return pc
    } as unknown as typeof RTCPeerConnection
    window.RTCPeerConnection.prototype = Orig.prototype
  })
}

interface RtcSample {
  outboundVideo: Array<Record<string, unknown>>
  outboundAudio: Array<Record<string, unknown>>
  inboundVideo: Array<Record<string, unknown>>
  inboundAudio: Array<Record<string, unknown>>
  candidatePair: Array<Record<string, unknown>>
}

async function sampleRtc(page: Page): Promise<RtcSample> {
  return page.evaluate(async () => {
    const w = window as unknown as { __pcs?: RTCPeerConnection[] }
    const out: Record<string, Array<Record<string, unknown>>> = {
      outboundVideo: [], outboundAudio: [], inboundVideo: [], inboundAudio: [], candidatePair: [],
    }
    for (const pc of w.__pcs ?? []) {
      let report: RTCStatsReport
      try {
        report = await pc.getStats()
      } catch {
        continue
      }
      report.forEach((s: Record<string, unknown>) => {
        const type = s.type as string
        const kind = (s.kind ?? s.mediaType) as string | undefined
        const pick = (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]))
        if (type === 'outbound-rtp' && kind === 'video') {
          out.outboundVideo.push(
            pick(['ssrc', 'rid', 'bytesSent', 'packetsSent', 'frameWidth', 'frameHeight',
              'framesPerSecond', 'framesEncoded', 'qualityLimitationReason', 'active',
              'targetBitrate', 'timestamp']),
          )
        } else if (type === 'outbound-rtp' && kind === 'audio') {
          out.outboundAudio.push(pick(['ssrc', 'bytesSent', 'packetsSent', 'targetBitrate', 'timestamp']))
        } else if (type === 'inbound-rtp' && kind === 'video') {
          out.inboundVideo.push(
            pick(['ssrc', 'bytesReceived', 'packetsReceived', 'packetsLost', 'jitter',
              'framesDecoded', 'frameWidth', 'frameHeight', 'freezeCount',
              'totalFreezesDuration', 'timestamp']),
          )
        } else if (type === 'inbound-rtp' && kind === 'audio') {
          out.inboundAudio.push(
            pick(['ssrc', 'bytesReceived', 'packetsReceived', 'packetsLost', 'jitter',
              'concealedSamples', 'totalSamplesReceived', 'timestamp']),
          )
        } else if (type === 'candidate-pair' && s.state === 'succeeded') {
          out.candidatePair.push(
            pick(['currentRoundTripTime', 'availableOutgoingBitrate', 'availableIncomingBitrate',
              'bytesSent', 'bytesReceived', 'timestamp']),
          )
        }
      })
    }
    return out as unknown as RtcSample
  })
}

/** Navigation + resource totals. These are meaningful only because the harness now
 *  points at `vite preview` — the BUILT bundle. Against the dev server the request
 *  count and byte totals describe unbundled ESM and say nothing about what a real
 *  user downloads, which is how the first shaped run produced an 88-request, 3.8 MB
 *  figure for a landing page that actually ships a fraction of that. */
async function loadMetrics(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const sum = (f: (r: PerformanceResourceTiming) => number) => res.reduce((a, r) => a + (f(r) || 0), 0)
    return {
      requests: res.length,
      transferBytes: sum((r) => r.transferSize),
      encodedBytes: sum((r) => r.encodedBodySize),
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      firstByteMs: nav ? Math.round(nav.responseStart) : null,
    }
  })
}

/**
 * Run a step and record how long it took, WITHOUT letting a failure throw.
 *
 * Every slow-link operation here goes through this. A timeout is a MEASUREMENT
 * ("the landing page did not finish loading inside the limit", "join did not
 * complete inside 45s"), not a broken test — and the first shaped run proved the
 * cost of forgetting that: an unwrapped page.goto threw at 120s and destroyed the
 * whole run's data, including the parts that had already succeeded.
 *
 * helpers.join() additionally carries its own hardcoded expect timeouts (20s for
 * the name field, 45s for the mic button), right for the normal suite and far too
 * tight here — the same reasoning applies.
 */
async function timedStep(fn: () => Promise<unknown>): Promise<{ ms: number; ok: boolean; error?: string }> {
  const t = Date.now()
  try {
    await fn()
    return { ms: Date.now() - t, ok: true }
  } catch (e) {
    return { ms: Date.now() - t, ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }
  }
}

/** Rate in kbps between two cumulative byte samples. */
function kbps(before: number, after: number, ms: number): number {
  return Math.round((((after - before) * 8) / 1000) * (1000 / ms))
}
function totalBytes(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0)
}

test('lowbw baseline: two-party call under the active network profile', async ({ browser }) => {
  const room = uniqueRoom('lowbw')
  const record: Record<string, unknown> = {
    profile: PROFILE,
    holdMs: HOLD_MS,
    startedAt: new Date().toISOString(),
  }

  // --- S-b: cold load of the room route, measured on the wire we were given.
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const pageA = await ctxA.newPage()
  await trackPeerConnections(pageA)

  const nav = await timedStep(() => pageA.goto('/', { waitUntil: 'load' }))
  record.landingLoadMs = nav.ms
  record.landingNav = nav
  // Worth attempting even after a timeout — a partially-loaded page still reports
  // how far it got, which is the interesting part when it doesn't finish.
  record.landing = await loadMetrics(pageA).catch(() => null)

  if (!nav.ok) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(joinPath(OUT_DIR, `${PROFILE}.json`), JSON.stringify(record, null, 2))
    console.log(`\n=== lowbw profile: ${PROFILE} — LANDING LOAD FAILED after ${nav.ms}ms ===`)
    console.log(JSON.stringify(record.landing, null, 2))
    console.log(nav.error)
    await closeContext(ctxA)
    return
  }

  // --- S-a: join, hold, and watch what the media layer actually does.
  const joinA = await timedStep(() => join(pageA, room, 'Ama'))
  record.joinMsA = joinA.ms
  record.joinA = joinA
  record.roomRoute = await loadMetrics(pageA)

  // If the first participant never got in, there is no call to measure. Write what
  // we have — the join duration and its error are the finding — and stop.
  if (!joinA.ok) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(joinPath(OUT_DIR, `${PROFILE}.json`), JSON.stringify(record, null, 2))
    console.log(`\n=== lowbw profile: ${PROFILE} — JOIN FAILED after ${joinA.ms}ms ===`)
    // Print the load numbers here too. On the success path they ride along with the
    // rates block, but a failed join is exactly when they matter most — without them
    // the log says the join failed and gives no way to tell a slow network from a
    // broken one, and the figures sit unread inside the artifact.
    console.log(JSON.stringify({ landingLoadMs: record.landingLoadMs, landing: record.landing, roomRoute: record.roomRoute }, null, 2))
    console.log(joinA.error)
    await closeContext(ctxA)
    return
  }

  let b: Awaited<ReturnType<typeof newParticipant>> | null = null
  const joinB = await timedStep(async () => {
    b = await newParticipant(browser, room, 'Kofi')
  })
  record.joinMsB = joinB.ms
  record.joinB = joinB

  // Two samples bracketing the hold give real rates rather than lifetime averages.
  const first = await sampleRtc(pageA)
  const tHold = Date.now()
  await pageA.waitForTimeout(HOLD_MS)
  const elapsed = Date.now() - tHold
  const second = await sampleRtc(pageA)

  record.rtcFirst = first
  record.rtcSecond = second
  record.rates = {
    elapsedMs: elapsed,
    videoUpKbps: kbps(totalBytes(first.outboundVideo, 'bytesSent'), totalBytes(second.outboundVideo, 'bytesSent'), elapsed),
    audioUpKbps: kbps(totalBytes(first.outboundAudio, 'bytesSent'), totalBytes(second.outboundAudio, 'bytesSent'), elapsed),
    videoDownKbps: kbps(totalBytes(first.inboundVideo, 'bytesReceived'), totalBytes(second.inboundVideo, 'bytesReceived'), elapsed),
    audioDownKbps: kbps(totalBytes(first.inboundAudio, 'bytesReceived'), totalBytes(second.inboundAudio, 'bytesReceived'), elapsed),
    // The question F1 turns on: is the encoder starved by bandwidth or by CPU?
    qualityLimitationReasons: second.outboundVideo.map((r) => r.qualityLimitationReason),
    // Did AUDIO — the thing that must survive — keep flowing at all?
    audioStillFlowing:
      totalBytes(second.inboundAudio, 'bytesReceived') > totalBytes(first.inboundAudio, 'bytesReceived'),
  }
  record.tiles = {
    a: await pageA.evaluate(() => document.querySelectorAll('video').length),
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = joinPath(OUT_DIR, `${PROFILE}.json`)
  writeFileSync(file, JSON.stringify(record, null, 2))
  // Surface the headline numbers in the job log too, so a run is readable without
  // downloading the artifact.
  console.log(`\n=== lowbw profile: ${PROFILE} ===`)
  console.log(JSON.stringify({ ...(record.rates as object), joinMsA: record.joinMsA, joinMsB: record.joinMsB, landing: record.landing }, null, 2))

  if (b) await closeContext((b as { context: Parameters<typeof closeContext>[0] }).context)
  await closeContext(ctxA)

  // The ONLY assertion: the harness produced a report. Network quality is measured,
  // never asserted — a profile that degrades the call badly must still finish green
  // with the numbers that prove it, or the harness stops being a measuring device.
  expect(record.rates).toBeTruthy()
})
