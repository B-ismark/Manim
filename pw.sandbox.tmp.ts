import base from './playwright.config'
import { defineConfig } from '@playwright/test'
const EXE = '/opt/pw-browsers/chromium'
const withExe = (o: Record<string, unknown> = {}) => ({ ...o, executablePath: EXE })
export default defineConfig({
  ...base,
  workers: 1,
  reporter: [['list']],
  use: { ...base.use, launchOptions: withExe(base.use?.launchOptions as Record<string, unknown>) },
  projects: (base.projects ?? []).map((p) => ({
    ...p,
    use: { ...p.use, launchOptions: withExe(p.use?.launchOptions as Record<string, unknown>) },
  })),
})
