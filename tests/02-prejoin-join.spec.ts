import { test, expect } from '@playwright/test'
import { uniqueRoom, attachErrorSink, appErrors, join } from './helpers'

test.describe('PreJoin + join', () => {
  test('Join now is gated on a name; device toggles flip labels', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    const joinBtn = page.getByRole('button', { name: 'Join now' })
    await expect(joinBtn).toBeVisible({ timeout: 20_000 })
    await expect(joinBtn).toBeDisabled()

    // Mic/cam toggle accessible-name flips.
    const mic = page.getByRole('button', { name: 'Mute microphone' })
    await expect(mic).toBeVisible()
    await mic.click()
    await expect(page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible()

    const cam = page.getByRole('button', { name: 'Turn off camera' })
    await cam.click()
    await expect(page.getByRole('button', { name: 'Turn on camera' })).toBeVisible()

    await page.getByLabel('Your name').fill('Ada')
    await expect(joinBtn).toBeEnabled()
  })

  /**
   * The preview must show the WHOLE camera frame.
   *
   * This screen exists to answer "what will everyone else see?", and a fixed-shape
   * box with object-cover answered it wrongly — a 4:3 webcam had its sides cropped
   * off, so people approved a framing they were never shown. The box takes the
   * camera's own shape instead, which is checkable: the rendered box aspect should
   * match the stream's, and the video should be `contain` so a clamped ratio still
   * shows everything rather than trimming to fit.
   */
  test('the camera preview shows the whole frame, at the camera’s own aspect', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible({ timeout: 20_000 })
    // Wait for real frames — the box only reshapes once the stream reports a size.
    await page.waitForFunction(
      () => {
        const v = document.querySelector('[data-testid="prejoin-preview"]') as HTMLVideoElement | null
        return !!v && v.videoWidth > 0
      },
      { timeout: 20_000 },
    )
    await page.waitForTimeout(300) // let the aspect land and lay out

    const fit = await page.evaluate(() => {
      // Addressed by testid, not "the first <video> on the page". The old selector
      // silently depended on the preview being the only video element and on its
      // immediate parent being the aspect-carrying box — two assumptions any layout
      // change can break, and a broken one here would pass against the wrong element
      // rather than fail.
      const v = document.querySelector('[data-testid="prejoin-preview"]') as HTMLVideoElement
      const box = v.parentElement as HTMLElement
      const r = box.getBoundingClientRect()
      return {
        stream: v.videoWidth / v.videoHeight,
        box: r.width / r.height,
        objectFit: getComputedStyle(v).objectFit,
      }
    })

    expect(fit.objectFit, 'the preview never crops').toBe('contain')
    // Within 2% — the box is sized from the same ratio, so this is tight.
    expect(Math.abs(fit.box - fit.stream) / fit.stream).toBeLessThan(0.02)
  })

  test('low-bandwidth disables the camera toggle', async ({ page }) => {
    await page.goto(`/r/${uniqueRoom()}`)
    await expect(page.getByRole('button', { name: 'Join now' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('switch', { name: /Low-bandwidth/i }).click()
    await expect(page.getByRole('button', { name: /camera/i })).toBeDisabled()
    await expect(page.getByText('Audio-only / low bandwidth')).toBeVisible()
  })

  test('full join → in-call → leave returns home', async ({ page }) => {
    const sink = attachErrorSink(page)
    const room = uniqueRoom()
    await join(page, room, 'Ada')
    // In-call chrome present.
    await expect(page.getByRole('button', { name: 'Open chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave call' })).toBeVisible()
    await page.getByRole('button', { name: 'Leave call' }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
    expect(appErrors(sink), `unexpected app errors: ${appErrors(sink).join('\n')}`).toEqual([])
  })

  test('Enter key in the name field joins', async ({ page }) => {
    const room = uniqueRoom()
    await page.goto(`/r/${room}`)
    const name = page.getByLabel('Your name')
    await expect(name).toBeVisible({ timeout: 20_000 })
    await name.fill('Grace')
    await name.press('Enter')
    await expect(page.getByRole('button', { name: /microphone/i }).first()).toBeVisible({
      timeout: 45_000,
    })
  })
})
