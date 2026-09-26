import { describe, it, expect } from 'vitest'
import { removedEntry, withRemoved, wasRemoved, MAX_REMOVED } from './removed.mjs'

describe('removed', () => {
  it('matches the same device under a new name, and the same account on a new device', async () => {
    const e = await removedEntry('Mallory#dev-123', 'user-9')
    const list = withRemoved(undefined, e)
    expect(await wasRemoved(list, 'dev-123', '')).toBe(true)
    expect(await wasRemoved(list, 'dev-999', 'user-9')).toBe(true)
    expect(await wasRemoved(list, 'dev-999', 'user-1')).toBe(false)
  })
  it('never bans the shared fallback device id', async () => {
    expect(await removedEntry('Guest#web', '')).toBeNull()
    const list = withRemoved([], await removedEntry('Guest#web', 'user-2'))
    expect(await wasRemoved(list, 'web', '')).toBe(false)
  })
  it('stores hashes, not the ids, and keeps only the newest', async () => {
    const e = await removedEntry('A#dev-1', 'user-1')
    expect(JSON.stringify(e)).not.toContain('dev-1')
    expect(JSON.stringify(e)).not.toContain('user-1')
    let list = []
    for (let i = 0; i < MAX_REMOVED + 5; i++) list = withRemoved(list, { d: String(i), u: '' })
    expect(list).toHaveLength(MAX_REMOVED)
    expect(list[0].d).toBe('5')
  })
})
