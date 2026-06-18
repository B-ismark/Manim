/*
 * Lightweight, transport-agnostic error reporter + breadcrumb trail.
 *
 * E1 in RESILIENCE-AUDIT.md: the app shipped with NO error reporting of any kind —
 * no global handlers, no ErrorBoundary report, and 50+ silent catches. Every
 * failure was invisible in production; you'd learn about a broken join / E2EE
 * silent-fail / dead processor only when a user complained.
 *
 * This is the seam. `reportError` / `addBreadcrumb` are safe no-ops today (they
 * log to the console and keep an in-memory breadcrumb ring), and they forward to
 * Sentry automatically the moment a `window.Sentry` is present (loaded via the
 * snippet / a future SDK wiring). Routing failures through here NOW — even with a
 * console-only transport — is what turns the rest of the audit's findings from
 * "invisible in prod" into "measurable": when Sentry is wired, every call site is
 * already reporting, no code churn required.
 */

interface SentryLike {
  captureException?: (error: unknown, context?: unknown) => void
  addBreadcrumb?: (breadcrumb: unknown) => void
}

declare global {
  interface Window {
    Sentry?: SentryLike
  }
}

type Context = Record<string, unknown>

interface Breadcrumb {
  t: number
  msg: string
  data?: Context
}

const RING_SIZE = 30
const breadcrumbs: Breadcrumb[] = []

// Drop identical errors that recur within a short window so a render loop or a
// per-frame failure can't flood the console (or the transport) with noise.
const DEDUPE_MS = 5000
const recentErrors = new Map<string, number>()

let installed = false

function sentry(): SentryLike | undefined {
  return typeof window !== 'undefined' ? window.Sentry : undefined
}

/** Record a contextual event leading up to a potential error (connection-state
 *  transitions, join attempts, device changes). Kept in a small ring and attached
 *  to the next reported error, mirroring Sentry's breadcrumb model. */
export function addBreadcrumb(msg: string, data?: Context): void {
  const crumb: Breadcrumb = { t: Date.now(), msg, ...(data ? { data } : {}) }
  breadcrumbs.push(crumb)
  if (breadcrumbs.length > RING_SIZE) breadcrumbs.shift()
  sentry()?.addBreadcrumb?.({ message: msg, data, level: 'info' })
}

/** Report an unexpected failure. Safe to call from any catch — it dedupes, logs
 *  with the recent breadcrumb trail, and forwards to Sentry when present. The
 *  principle (E2): swallow the *expected* silently, route the *unexpected* here. */
export function reportError(error: unknown, context?: Context): void {
  const message = error instanceof Error ? error.message : String(error)
  const now = Date.now()
  const last = recentErrors.get(message)
  if (last !== undefined && now - last < DEDUPE_MS) return
  recentErrors.set(message, now)

  // eslint-disable-next-line no-console
  console.error('[report]', message, { context, breadcrumbs: [...breadcrumbs] }, error)
  sentry()?.captureException?.(error, { extra: { ...context, breadcrumbs: [...breadcrumbs] } })
}

/** Install the global last-resort handlers. Idempotent; call once at startup
 *  (main.tsx) BEFORE the app mounts so an early throw is still caught. */
export function initErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (e) => {
    // Resource load errors (img/script) surface here with no `error` object —
    // ignore those; they're not actionable app exceptions.
    if (e.error) reportError(e.error, { source: 'window.onerror' })
  })

  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason ?? new Error('Unhandled promise rejection'), {
      source: 'unhandledrejection',
    })
  })
}
