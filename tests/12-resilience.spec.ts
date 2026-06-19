import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { uniqueRoom, join, isTouch } from './helpers'

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
