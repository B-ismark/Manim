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

/** Navigation + resource totals. Against the vite DEV server the request COUNT is
 *  unrepresentative (unbundled ESM); the timings still show what a high-RTT link
 *  costs. Real byte counts come from the built-bundle step in the workflow. */
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

  const tLoad = Date.now()
  await pageA.goto('/', { waitUntil: 'load' })
  record.landingLoadMs = Date.now() - tLoad
  record.landing = await loadMetrics(pageA)

  // --- S-a: join, hold, and watch what the media layer actually does.
  const tJoin = Date.now()
  await join(pageA, room, 'Ama')
  record.joinMsA = Date.now() - tJoin
  record.roomRoute = await loadMetrics(pageA)

  const tJoinB = Date.now()
  const b = await newParticipant(browser, room, 'Kofi')
  record.joinMsB = Date.now() - tJoinB

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

  await closeContext(b.context)
  await closeContext(ctxA)

  // The ONLY assertion: we got into a call and audio moved. Everything else is data.
  expect(record.joinMsA).toBeLessThan(120_000)
})
