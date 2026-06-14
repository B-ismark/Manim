import { useEffect, useState } from 'react'

/** Animated "broadcast" loader — SVG + CSS only (no Lottie dep / hosted asset). */
function Loader() {
  return (
    <svg viewBox="0 0 120 120" className="size-28" role="img" aria-label="Connecting">
      {/* Rings ping outward, staggered. */}
      {[0, 0.63, 1.26].map((delay, i) => (
        <circle
          key={i}
          cx="60"
          cy="60"
          r="20"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          className="mn-ring"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      {/* Pulsing core with a small camera glyph. */}
      <circle cx="60" cy="60" r="18" fill="var(--color-accent)" className="mn-core" />
      <g className="mn-core" fill="var(--color-accent-ink)">
        <rect x="51" y="55" width="11" height="10" rx="2.5" />
        <path d="M62 59l6-3v8l-6-3z" />
      </g>
    </svg>
  )
}

const TIPS = [
  'Securing your connection…',
  'Warming up the camera…',
  'Finding the best route…',
  'Almost there…',
]

/**
 * Full-screen joining state. Shown while knocking/connecting so the wait feels
 * intentional rather than blank. Cycles short status tips.
 */
export function JoiningScreen({ room, label = 'Joining' }: { room?: string; label?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setI((v) => v + 1), 2600)
    return () => window.clearInterval(id)
  }, [])

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="flex flex-col items-center gap-6 text-center">
        <Loader />
        <div>
          <p className="text-xs font-medium text-ink-subtle">{label}</p>
          {room && <h1 className="mt-0.5 text-xl font-semibold">{room}</h1>}
          <p className="mt-2 text-sm text-ink-muted">{TIPS[i % TIPS.length]}</p>
        </div>
      </div>
    </main>
  )
}
