import { useCallback, useRef, useState } from 'react'
import {
  useDataChannel,
  useLocalParticipant,
  useParticipantAttribute,
} from '@livekit/components-react'
import type { Participant } from 'livekit-client'

/** Ephemeral reaction broadcast topic. */
const REACTION_TOPIC = 'mn.reaction'
/** Persistent per-participant attribute holding raise-hand state ('1' = raised). */
export const HAND_ATTR = 'mn.hand'

/** The reaction palette shown in the picker. Meaning never relies on color alone (STYLE.md §6). */
export const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '😮'] as const

export interface FloatingReaction {
  key: string
  emoji: string
  fromName: string
}

function displayName(identity: string, name?: string): string {
  return name || identity.split('#')[0] || 'Guest'
}

const REACTION_TTL = 4000

/**
 * Ephemeral reactions over the data channel + raise-hand via participant attributes.
 * Reactions auto-expire; hand state persists until lowered. Returns the live list
 * for the overlay and senders/toggles for the control bar.
 */
export function useReactions() {
  const { localParticipant } = useLocalParticipant()
  const [active, setActive] = useState<FloatingReaction[]>([])
  const counter = useRef(0)
  const timers = useRef<number[]>([])

  const push = useCallback((emoji: string, fromName: string) => {
    const key = `r-${counter.current++}`
    setActive((prev) => [...prev, { key, emoji, fromName }])
    const t = window.setTimeout(() => {
      setActive((prev) => prev.filter((r) => r.key !== key))
    }, REACTION_TTL)
    timers.current.push(t)
  }, [])

  const { send } = useDataChannel(REACTION_TOPIC, (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as { emoji?: string }
      if (!data.emoji) return
      const from = msg.from
      push(data.emoji, displayName(from?.identity ?? '', from?.name))
    } catch {
      /* malformed payload — ignore */
    }
  })

  const sendReaction = useCallback(
    async (emoji: string) => {
      push(emoji, displayName(localParticipant.identity, localParticipant.name))
      const payload = new TextEncoder().encode(JSON.stringify({ emoji }))
      try {
        await send(payload, { reliable: false, topic: REACTION_TOPIC })
      } catch {
        /* best-effort — reactions are lossy by design */
      }
    },
    [send, push, localParticipant],
  )

  const handRaised = useParticipantAttribute(HAND_ATTR, { participant: localParticipant }) === '1'

  const toggleHand = useCallback(async () => {
    await localParticipant.setAttributes({ [HAND_ATTR]: handRaised ? '' : '1' })
  }, [handRaised, localParticipant])

  return { active, sendReaction, handRaised, toggleHand }
}

/** Read whether a given participant currently has their hand raised. */
export function useHandRaised(participant?: Participant): boolean {
  return useParticipantAttribute(HAND_ATTR, { participant }) === '1'
}
