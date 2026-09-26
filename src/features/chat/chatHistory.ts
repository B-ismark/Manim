import { useMemo } from 'react'
import { useRoomInfo } from '@livekit/components-react'

/**
 * Whether people who join later are shown earlier chat — a host setting
 * (`chatHistory` in server-written room metadata; absent = on, which is how every
 * room behaved before it existed).
 *
 * There is no server copy of chat to switch off: history is REPLAYED by peers who
 * are still in the room. So the rule is enforced where the replay happens — a peer
 * with the setting off doesn't answer the request, and a joiner with it off
 * ignores any answer — and a single stale client can't leak it on its own.
 */
export function readChatHistory(metadata: string | undefined): boolean {
  try {
    return JSON.parse(metadata || '{}').chatHistory !== false
  } catch {
    return true
  }
}

export function useChatHistoryOn(): boolean {
  const { metadata } = useRoomInfo()
  return useMemo(() => readChatHistory(metadata), [metadata])
}
