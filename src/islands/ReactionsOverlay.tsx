import type { CSSProperties } from 'react'
import type { FloatingReaction } from '@/features/reactions/useReactions'

/**
 * Floating reaction layer. Emoji rise from above the control bar in fixed lanes
 * (offset assigned at creation) so they don't overlap; motion auto-reduces via
 * the global prefers-reduced-motion rule (STYLE.md §6/§8).
 */
export function ReactionsOverlay({ reactions }: { reactions: FloatingReaction[] }) {
  if (reactions.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center">
      <div className="relative h-0 w-full max-w-md">
        {reactions.map((r) => (
          <div
            key={r.key}
            className="mn-float absolute bottom-0 left-1/2 flex flex-col items-center"
            style={{ '--x': `${r.offset}px` } as CSSProperties}
          >
            <span className="text-4xl drop-shadow">{r.emoji}</span>
            <span className="mt-1 rounded-control bg-scrim px-2 py-0.5 text-xs text-white">{r.fromName}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
