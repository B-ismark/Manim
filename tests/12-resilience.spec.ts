import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { uniqueRoom, join, isTouch, fakeScreenShare, startScreenShare, usingLocalLiveKit } from './helpers'

// The app's recovery layer (ConnectionBanner + the assertive "Reconnected"
// announcement) only fires on a real connection fault — the happy-path suite
// never exercises it (audit T1). The network transport can't be cut from the test
// side (CDP/setOffline don't reach the established WebRTC path), so we drive
// LiveKit's own fault simulation via a DEV-only window handle on the Room.
//
// We assert on the Room's Reconnecting→Reconnected EVENT sequence rather than
// racing the DOM: against LiveKit Cloud a solo reconnect completes faster than a
// DOM poll can sample the transient banner, but the events fire deterministically
// — and the banner + announcer are wired directly to these same events, so the
// sequence firing is what proves the recovery path is driven end-to-end.
//
// Errors here (net::ERR_, ConnectionError) are the POINT of the test, so we don't
// assert on the error sink.

declare global {
  interface Window {
    __lkRoom?: {
      simulateScenario: (s: string) => Promise<void>
      on: (e: string, cb: () => void) => unknown
    }
    __lkEvents?: string[]
  }
}

async function armAndSimulate(page: Page, scenario: string): Promise<boolean> {
  return page.evaluate((s) => {
    const room = window.__lkRoom
    if (!room) return false
    window.__lkEvents = []
    room.on('reconnecting', () => window.__lkEvents!.push('reconnecting'))
    room.on('reconnected', () => window.__lkEvents!.push('reconnected'))
    void room.simulateScenario(s)
    return true
  }, scenario)
}

test.describe('Resilience — connection fault recovery', () => {
  test('a connection fault drives the Reconnecting → Reconnected recovery cycle', async ({
    page,
  }) => {
    // The recovery state machine (ConnectionBanner + announcer) is platform-agnostic
    // — run it once on desktop. Mobile layout of the banner is covered by the
    // no-scroll fit gate; re-running the fault sim under device emulation only adds
    // timing flake without new coverage.
    test.skip(await isTouch(page), 'reconnect logic is device-agnostic; verified on desktop')
    // A `livekit-server --dev` does not drive the reconnect state machine the way
    // Cloud does: the injected fault produces no 'reconnecting' event at all
    // (window.__lkEvents stays empty for the full 45s). That is the backend, not
    // this app, so the spec is skipped rather than left failing where it proves
    // nothing. It still runs against Cloud, which is where it means something.
    test.skip(usingLocalLiveKit, 'the fault simulation needs LiveKit Cloud, not a dev server')
    const room = uniqueRoom('resil')
    await join(page, room, 'Dropper')

    // Arm event capture, then force a full reconnect.
    const armed = await armAndSimulate(page, 'leave-full-reconnect')
    expect(armed, 'DEV test seam window.__lkRoom must be present').toBe(true)

    // The Room must enter Reconnecting (the state the ConnectionBanner +
    // "Connection lost. Reconnecting…" announcement render on)…
    await expect
      .poll(() => page.evaluate(() => window.__lkEvents ?? []), { timeout: 45_000 })
      .toContain('reconnecting')

    // …and then recover (drives the assertive "Reconnected" announcement + banner
    // unmount).
    await expect
      .poll(() => page.evaluate(() => window.__lkEvents ?? []), { timeout: 45_000 })
      .toContain('reconnected')

    // After recovery the in-call chrome is still functional and the banner is gone.
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible()
    await expect(page.getByText(/Reconnecting/)).toBeHidden()
  })
})

/**
 * A screen share can end without the user touching our Stop button — Chrome's own
 * "Stop sharing" bar, or (the case that actually bites) sharing a single
 * application WINDOW and then closing that window. The capture ends, LiveKit
 * unpublishes, and the tile vanishes for everyone.
 *
 * Camera and mic have been watched for this since the device-loss work; the screen
 * share never was, so that vanishing arrived with no explanation — from the
 * presenter's seat their screen just silently stopped being shared.
 *
 * `track.stop()` deliberately does NOT fire `ended` (that's what keeps our own Stop
 * button from false-firing), so the external termination is simulated the only way
 * a test can: dispatching the event the browser would have dispatched.
 */
test.describe('Resilience — screen share ends externally', () => {
  test('an externally-ended screen share is explained, with a way back', async ({ page }) => {
    test.setTimeout(120_000)
    test.skip(await isTouch(page), 'screen share lives on the desktop control bar')

    await fakeScreenShare(page, 1280, 720)
    await join(page, uniqueRoom('shareend'), 'Presenter')
    await startScreenShare(page)

    const fired = await page.evaluate(() => {
      const room = window.__lkRoom as unknown as {
        localParticipant: {
          getTrackPublication: (s: string) => { track?: { mediaStreamTrack?: MediaStreamTrack } } | undefined
        }
      }
      const mst = room?.localParticipant?.getTrackPublication('screen_share')?.track?.mediaStreamTrack
      if (!mst) return false
      mst.dispatchEvent(new Event('ended'))
      return true
    })
    expect(fired, 'reached the live screen-share track').toBe(true)

    // The presenter is told what happened, and offered the one-tap way back —
    // rather than discovering it when someone says they can't see the screen.
    // Scoped to the VISIBLE banner. The same sentence is also written into two
    // sr-only live regions (polite + assertive), so a bare getByText matches three
    // nodes and dies on strict mode — a real bug in this spec that went unseen
    // because nothing had run it since the freeze.
    await expect(
      page.locator('span').filter({ hasText: 'Screen sharing stopped' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Share again' })).toBeVisible()
  })
})
