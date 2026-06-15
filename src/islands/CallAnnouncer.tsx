import { useEffect, useRef, useState } from 'react'
import { useLocalParticipant, useParticipants } from '@livekit/components-react'
import type { Participant } from 'livekit-client'

function nameOf(p: Participant): string {
  return p.name || p.identity.split('#')[0] || 'Someone'
}

/**
 * Visually-hidden live region that voices call state for screen readers
 * (WCAG 4.1.3 Status Messages): participants joining/leaving and your own mic
 * being muted/unmuted. Renders nothing visible; no behavioural effect for
 * sighted users.
 */
export function CallAnnouncer() {
  const participants = useParticipants()
  const { isMicrophoneEnabled } = useLocalParticipant()
  const [message, setMessage] = useState('')

  const prevIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(participants.map((p) => p.identity))
    const prev = prevIds.current
    prevIds.current = ids
    if (!prev) return // skip the initial roster
    const joined = participants.filter((p) => !prev.has(p.identity))
    const left = [...prev].filter((id) => !ids.has(id))
    if (joined.length === 1) setMessage(`${nameOf(joined[0])} joined the call`)
    else if (joined.length > 1) setMessage(`${joined.length} people joined`)
    else if (left.length === 1) setMessage('Someone left the call')
    else if (left.length > 1) setMessage(`${left.length} people left`)
  }, [participants])

  const firstMic = useRef(true)
  useEffect(() => {
    if (firstMic.current) {
      firstMic.current = false
      return
    }
    setMessage(isMicrophoneEnabled ? 'Microphone on' : 'Microphone muted')
  }, [isMicrophoneEnabled])

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  )
}
