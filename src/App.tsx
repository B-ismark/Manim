import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/primitives'
import { Landing } from '@/routes/Landing'
import { IncomingCallBanner } from '@/islands/IncomingCallBanner'
import { Toasts } from '@/islands/Toasts'

// The call route pulls in the LiveKit client (the heavy dependency). Lazy-load
// it so the landing page ships almost none of it (lightweight goal).
const RoomRoute = lazy(() =>
  import('@/routes/RoomRoute').then((m) => ({ default: m.RoomRoute })),
)

export function App() {
  return (
    <TooltipProvider>
      <Toasts />
      <IncomingCallBanner />
      <Routes>
        <Route path="/" element={<Landing />} />
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
    </TooltipProvider>
  )
}
