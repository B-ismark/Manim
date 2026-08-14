import { defineConfig, devices } from '@playwright/test'

/*
 * Separate config for the low-bandwidth baseline measurement (tests/lowbw/).
 *
 * Kept apart from playwright.config.ts — which `testIgnore`s this directory — for
 * two reasons: the measurement is slow by design (it holds a call open for tens of
 * seconds), and it is meant to run under a network shaper where the normal suite's
 * timeouts would be meaningless. It must never be pulled into `npm test`.
 *
 * No retries: a retry would silently average two runs under different shaper warmup
 * states, and this produces measurements rather than verdicts. A failed run is
 * information, not something to paper over.
 */
const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

export default defineConfig({
  testDir: './tests/lowbw',
  // Sized from the worst case the staged join can actually reach: a 240s landing
  // navigation, then two joins each budgeted at nav 120s + prejoin 60s + click 60s
  // + in-call 150s, plus the hold. Roughly 18 minutes if every stage runs to its
  // limit. The job's own 30-minute cap is the real backstop.
  timeout: 20 * 60_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'lowbw-report/playwright.json' }]],
  use: {
    // Defaults to the `vite preview` port — the BUILT bundle, which is the only
    // artifact whose byte count means anything. Override to point at the dev
    // server (:5173) only if you specifically want to compare the two.
    baseURL: process.env.LOWBW_BASE_URL ?? 'http://localhost:4173',
    headless: true,
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 800 },
    // Generous: every navigation here is deliberately running over a bad link.
    actionTimeout: 60_000,
    navigationTimeout: 240_000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { args: FAKE_MEDIA },
  },
  projects: [
    { name: 'lowbw', use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } } },
  ],
})
