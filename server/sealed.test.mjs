import { describe, it, expect } from 'vitest'
import { seal, unseal } from './sealed.mjs'

describe('sealed', () => {
  it('round-trips and hides the content', async () => {
    const q = [{ id: 'r1', name: 'Ada', deviceId: 'dev-1', userId: 'u-1', status: 'pending', ts: 1 }]
    const s = await seal('secret', 'room-a', q)
    expect(s).not.toContain('Ada')
    expect(s).not.toContain('dev-1')
    expect(await unseal('secret', 'room-a', s, [])).toEqual(q)
  })

  it('refuses another room, another secret, tampering and junk', async () => {
    const s = await seal('secret', 'room-a', [1])
    expect(await unseal('secret', 'room-b', s, 'no')).toBe('no')
    expect(await unseal('other', 'room-a', s, 'no')).toBe('no')
    const bad = s.slice(0, -4) + (s.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(await unseal('secret', 'room-a', bad, 'no')).toBe('no')
    expect(await unseal('secret', 'room-a', undefined, 'no')).toBe('no')
    expect(await unseal('secret', 'room-a', '!!', 'no')).toBe('no')
  })
})
