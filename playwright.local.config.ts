import base from './playwright.config'
const CHROME = '/opt/pw-browsers/chromium'
const withExe = (p: any) => ({
  ...p,
  use: { ...p.use, launchOptions: { ...(p.use?.launchOptions ?? {}), executablePath: CHROME } },
})
export default { ...base, projects: (base.projects ?? []).map(withExe) }
