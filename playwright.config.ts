import { defineConfig, devices } from '@playwright/test'

// E2E config for the Manim LiveKit app. Servers (vite :5173 + token :3001) are
// expected to be already running via `npm run dev`. Fake media so headless
// Chromium has a camera/mic without hardware. Connections are real (LiveKit
// Cloud creds live in .env), so keep worker count low to avoid overloading the
// local machine + the LiveKit room.
const FAKE_MEDIA = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
]

export default defineConfig({
  testDir: './tests',
  // LiveKit join + media negotiation is slow; give each test room to breathe.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  // One retry in CI — real LiveKit + WebRTC negotiation is occasionally flaky
  // under load (and a fork PR can't change this). Local stays 0 for fast signal.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { args: FAKE_MEDIA },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: { args: FAKE_MEDIA } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { args: FAKE_MEDIA } } },
    // Short phone (375x667, iPhone-SE size) — used for the real-estate / no-scroll
    // fit checks (11-mobile-fit), which a tall Pixel 7 can mask. Chromium (not the
    // WebKit 'iPhone SE' device) so it reuses the fake-media flags; just the small
    // touch viewport. Not the full suite (behaviour is identical) — CI cost stays low.
    {
      name: 'mobile-sm',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 375, height: 667 },
        launchOptions: { args: FAKE_MEDIA },
      },
    },
  ],
})
