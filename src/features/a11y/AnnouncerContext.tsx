import { createContext, useContext, type ReactNode } from 'react'
import { useAnnouncer } from './useAnnouncer'

type Announce = (text: string, urgency?: 'polite' | 'assertive') => void

/**
 * Shared screen-reader announcer for the whole call subtree.
 *
 * Previously each consumer (CallAnnouncer) owned a private `useAnnouncer()`, so a
 * non-component caller — e.g. the mid-call device-loss watch (E5) — had no way to
 * voice an assertive message. This lifts ONE announcer to a context: it renders
 * the live regions once, and any descendant (component or hook) gets `announce`
 * via `useAnnounce()`. Defaults to a no-op so a stray call outside the provider
 * (or in a test) is harmless rather than a crash.
 */
const AnnounceContext = createContext<Announce>(() => {})

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const { announce, regions } = useAnnouncer()
  return (
    <AnnounceContext.Provider value={announce}>
      {regions}
      {children}
    </AnnounceContext.Provider>
  )
}

/** Get the shared `announce(text, urgency?)`. No-op outside an AnnouncerProvider. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext)
}
