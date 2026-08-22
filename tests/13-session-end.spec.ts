import { test, expect } from '@playwright/test'
import {
  closeContext,
  join,
  newParticipant,
  openEndCallConfirm,
  uniqueRoom,
} from './helpers'

// Plain "Leave" is covered by 02-prejoin. The DESTRUCTIVE teardown —
// end-for-everyone — wasn't (audit T2). The host reaches it behind the caret on
// their split Leave control with a mouse, and from the More sheet on touch (that
// caret is too small for a thumb, so it isn't offered there) — openEndCallConfirm
// takes whichever route this platform has. On confirm it both broadcasts an
// { type:'end' } control message AND closes the room server-side (so a
// mid-reconnect peer can't be stranded, finding #13). This test exercises the
// host->guest disconnect path; the server-side close is what makes the race safe.
test.describe('Session — end for everyone', () => {
  test('host ends the call; the guest is disconnected back to landing', async ({ page, browser }) => {
    const room = uniqueRoom('end')
    // First joiner is host and gets the split leave/end control.
    await join(page, room, 'Host')
    const guest = await newParticipant(browser, room, 'Guest')

    try {
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })

      // Host reaches end-for-everyone the way their platform offers it (caret menu
      // on a pointer, More sheet on touch) and confirms.
      await openEndCallConfirm(page)
      await page.getByRole('button', { name: 'End for everyone' }).click()

      // Guest receives the end signal and is taken out of the call: in-call chrome
      // disappears and they land back on the home screen (room-name field).
      await expect(guest.page.getByRole('button', { name: /microphone/i }).first()).toBeHidden({
        timeout: 30_000,
      })
      await expect(guest.page.getByPlaceholder('e.g. team-standup')).toBeVisible({ timeout: 15_000 })
    } finally {
      await closeContext(guest.context)
    }
  })

  test('a guest mid-reconnect is still ejected when the host ends (no strand, #13)', async ({
    page,
    browser,
  }) => {
    const room = uniqueRoom('end-race')
    await join(page, room, 'Host')
    const guest = await newParticipant(browser, room, 'Guest')

    try {
      await expect(page.getByRole('button', { name: /Participants \(2\)/ })).toBeVisible({
        timeout: 30_000,
      })

      // Put the guest into a reconnect, then end from the host in the same window —
      // the 'end' broadcast can be missed while the guest's signalling is down, so
      // only the server-side room close (endRoom) guarantees they don't end up
      // stranded alone in a room that should no longer exist.
      await guest.page.evaluate(() => {
        const r = (window as unknown as { __lkRoom?: { simulateScenario: (s: string) => Promise<void> } }).__lkRoom
        void r?.simulateScenario('leave-full-reconnect')
      })
      await openEndCallConfirm(page)
      await page.getByRole('button', { name: 'End for everyone' }).click()

      // However the guest's reconnect resolves, they must not remain in-call.
      await expect(guest.page.getByRole('button', { name: /microphone/i }).first()).toBeHidden({
        timeout: 45_000,
      })
      await expect(guest.page.getByPlaceholder('e.g. team-standup')).toBeVisible({ timeout: 15_000 })
    } finally {
      await closeContext(guest.context)
    }
  })
})
