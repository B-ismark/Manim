import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Two-channel screen-reader announcer (WCAG 4.1.3 Status Messages).
 *
 * Why a hook and not just a bare <div aria-live>: rapid state changes in a call
 * (two people join in the same tick, mic toggles while someone leaves) overwrite
 * a single text node before the AT has voiced it, so messages get dropped. This
 * queues them and releases one per tick, clearing between each so even identical
 * consecutive messages ("Microphone muted" twice) are re-announced.
 *
 * - `polite`  — most status (joins/leaves, hands, share) — waits for a pause.
 * - `assertive` — interrupts immediately. Reserve for things the user must hear
 *   NOW: being force-muted by a host, losing/regaining the connection.
 *
 * Returns `announce(message, urgency?)` plus the two live-region nodes to render
 * once, near the root of the call tree. Render nothing else into these regions.
 */
type Urgency = 'polite' | 'assertive'

const RELEASE_MS = 150 // gap between dequeued messages so each is voiced

export function useAnnouncer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')

  const queue = useRef<{ text: string; urgency: Urgency }[]>([])
  const draining = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const drain = useCallback(() => {
    const next = queue.current.shift()
    if (!next) {
      draining.current = false
      return
    }
    draining.current = true
    // Clear first so an identical back-to-back message still triggers a change.
    if (next.urgency === 'assertive') {
      setAssertive('')
      requestAnimationFrame(() => setAssertive(next.text))
    } else {
      setPolite('')
      requestAnimationFrame(() => setPolite(next.text))
    }
    timer.current = setTimeout(drain, RELEASE_MS)
  }, [])

  const announce = useCallback(
    (text: string, urgency: Urgency = 'polite') => {
      if (!text) return
      queue.current.push({ text, urgency })
      if (!draining.current) drain()
    },
    [drain],
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /**
   * Mount once. role="status"/"alert" are paired with aria-live so AT that keys
   * on either picks them up. aria-atomic re-reads the whole node each change.
   */
  const regions = (
    <>
      <div aria-live="polite" role="status" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" role="alert" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </>
  )

  return { announce, regions }
}
