import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/primitives'
import { Landing } from '@/routes/Landing'
import { Privacy, Terms } from '@/routes/Legal'
import { IncomingCallBanner } from '@/islands/IncomingCallBanner'
import { ErrorBoundary, clearChunkReloadGuard } from '@/islands/ErrorBoundary'
import { Toasts } from '@/islands/Toasts'

// The call route pulls in the LiveKit client (the heavy dependency). Lazy-load
// it so the landing page ships almost none of it (lightweight goal).
const RoomRoute = lazy(() =>
  import('@/routes/RoomRoute').then((m) => ({ default: m.RoomRoute })),
)

export function App() {
  // Re-arm the stale-chunk auto-reload once we've loaded healthily for a few
  // seconds (so a future deploy can auto-recover, without a reload loop).
  useEffect(() => {
    const t = window.setTimeout(clearChunkReloadGuard, 5000)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <TooltipProvider>
      <ErrorBoundary>
        <Toasts />
        <IncomingCallBanner />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route
            path="/r/:room"
            element={
              <Suspense fallback={<div className="grid min-h-dvh place-items-center text-ink-muted">Loading…</div>}>
                <RoomRoute />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </TooltipProvider>
  )
}
