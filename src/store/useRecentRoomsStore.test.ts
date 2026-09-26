import { beforeEach, describe, expect, it } from 'vitest'
import { useRecentRoomsStore, type RecentRoom } from './useRecentRoomsStore'

const now = Date.now()
const room = (slug: string, ago: number, extra: Partial<RecentRoom> = {}): RecentRoom => ({
  slug,
  name: slug,
  ts: now - ago,
  ...extra,
})

describe('recent calls merge (another device’s list)', () => {
  beforeEach(() => useRecentRoomsStore.setState({ rooms: [] }))

  it('adds calls made elsewhere, newest first', () => {
    useRecentRoomsStore.setState({ rooms: [room('laptop-call', 5000)] })
    useRecentRoomsStore.getState().merge([room('phone-call', 1000)])
    expect(useRecentRoomsStore.getState().rooms.map((r) => r.slug)).toEqual(['phone-call', 'laptop-call'])
  })

  it('never lets a copy it couldn’t open erase a link this device already has', () => {
    useRecentRoomsStore.setState({ rooms: [room('crit', 5000, { secret: 's1', e2ee: 'k1' })] })
    // Newer on the server, but sealed for other devices: no secrets here.
    useRecentRoomsStore.getState().merge([room('crit', 1000)])
    const [r] = useRecentRoomsStore.getState().rooms
    expect(r.ts).toBe(now - 1000)
    expect(r.secret).toBe('s1')
    expect(r.e2ee).toBe('k1')
  })

  it('drops rows past the 30-day window and caps the list', () => {
    const month = 31 * 24 * 60 * 60 * 1000
    useRecentRoomsStore
      .getState()
      .merge([room('old', month), ...Array.from({ length: 9 }, (_, i) => room(`r${i}`, i * 1000))])
    const slugs = useRecentRoomsStore.getState().rooms.map((r) => r.slug)
    expect(slugs).not.toContain('old')
    expect(slugs).toHaveLength(6)
    expect(slugs[0]).toBe('r0')
  })
})
