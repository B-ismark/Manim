import { useEffect, useRef, useState } from 'react'
import { useLocalParticipant, useParticipants } from '@livekit/components-react'
import type { Participant } from 'livekit-client'
import { HAND_ATTR } from '@/features/reactions/useReactions'

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

  // Announce raised hands (the mn.hand attribute) so they aren't a purely visual
  // cue. Keyed on the set of raised identities so it fires only on change.
  const raisedKey = participants
    .filter((p) => p.attributes?.[HAND_ATTR] === '1')
    .map((p) => p.identity)
    .sort()
    .join('|')
  const prevRaised = useRef<Set<string> | null>(null)
  useEffect(() => {
    const raised = new Set(raisedKey ? raisedKey.split('|') : [])
    const prev = prevRaised.current
    prevRaised.current = raised
    if (!prev) return
    const newly = participants.filter((p) => raised.has(p.identity) && !prev.has(p.identity))
    if (newly.length === 1) setMessage(`${nameOf(newly[0])} raised their hand`)
    else if (newly.length > 1) setMessage(`${newly.length} people raised their hands`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raisedKey])

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  )
}
