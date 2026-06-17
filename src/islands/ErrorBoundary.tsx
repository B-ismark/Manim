import { Component, type ReactNode } from 'react'
import { Island, Button } from '@/components/primitives'

/** A dynamic-import (code-split chunk) failure — the common cause is a new deploy
 *  that rotated chunk hashes while an old tab was still open, so the chunk 404s. */
function isChunkLoadError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    m.includes('dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('loading chunk') ||
    m.includes('failed to fetch dynamically')
  )
}

const RELOAD_FLAG = 'mn-chunk-reloaded'

/** Re-arm the one-shot stale-chunk auto-reload once the app has loaded healthily,
 *  so a LATER deploy can auto-recover too (without risking a reload loop on a
 *  persistent failure). Call after a short delay from a successful mount. */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    /* ignore */
  }
}

interface State {
  error: Error | null
}

/**
 * Catches render-time + lazy-import errors so a failure shows a recoverable screen
 * instead of a blank white page (e.g. accepting a call → the in-call chunk fails
 * to load). On a stale-chunk error it reloads ONCE automatically (a fresh deploy
 * just needs the new index/chunks); the one-shot sessionStorage guard prevents a
 * reload loop if the failure is persistent.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1')
          window.location.reload()
          return
        }
      } catch {
        /* storage blocked — fall through to the manual UI */
      }
    }
    // Real (non-chunk) errors: log for diagnosis; the fallback UI handles recovery.
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const stale = isChunkLoadError(this.state.error)
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <Island pad="lg" className="w-full max-w-sm text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {stale
              ? 'The app updated in the background. Reload to get the latest version.'
              : 'An unexpected error interrupted the app. Reloading usually fixes it.'}
          </p>
          <Button
            variant="accent"
            className="mt-4"
            onClick={() => {
              try {
                sessionStorage.removeItem(RELOAD_FLAG)
              } catch {
                /* ignore */
              }
              window.location.assign('/')
            }}
          >
            Reload
          </Button>
        </Island>
      </main>
    )
  }
}
