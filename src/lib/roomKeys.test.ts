import { describe, it, expect, beforeEach } from 'vitest'
import {
  forgetRoomSecrets,
  isAuthFragment,
  recallRoomSecrets,
  rememberRoomSecrets,
  resolveRoomSecrets,
} from './roomKeys'

/** Minimal in-memory localStorage — these tests run in the Node environment. */
function installStorage(impl?: Partial<Storage>) {
  const data = new Map<string, string>()
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
    ...impl,
  }
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
  return data
}

beforeEach(() => {
  installStorage()
})

describe('resolveRoomSecrets', () => {
  it('remembers what a link carried, and hands it back when the next one does not', () => {
    const link = { secret: '1.abc', e2ee: 'xyz' }
    expect(resolveRoomSecrets('standup', link)).toEqual(link)
    // …the sign-in round trip comes back with the provider's fragment instead.
    expect(resolveRoomSecrets('standup', {})).toEqual(link)
  })

  it('is per room — one room’s link never answers for another', () => {
    resolveRoomSecrets('standup', { secret: '1.abc' })
    expect(resolveRoomSecrets('retro', {})).toEqual({})
  })

  it('a link that carries anything wins WHOLESALE — no merging a stale key into it', () => {
    // The dangerous "helpful" version: fill the missing `e2ee` from memory. A room
    // deliberately shared without E2EE would silently acquire a key and publish
    // ciphertext nobody else could decode.
    resolveRoomSecrets('standup', { secret: '1.old', e2ee: 'oldkey' })
    expect(resolveRoomSecrets('standup', { secret: '2.new' })).toEqual({ secret: '2.new' })
  })

  it('a fresh link replaces what we remembered', () => {
    resolveRoomSecrets('standup', { secret: '1.old' })
    resolveRoomSecrets('standup', { secret: '2.new' })
    expect(recallRoomSecrets('standup')).toMatchObject({ secret: '2.new' })
  })

  it('nothing in the link and nothing remembered is not an error, just nothing', () => {
    expect(resolveRoomSecrets('standup', {})).toEqual({})
  })
})

describe('forgetRoomSecrets', () => {
  it('drops a rejected secret so it cannot fail forever', () => {
    resolveRoomSecrets('standup', { secret: '1.stale' })
    forgetRoomSecrets('standup')
    expect(resolveRoomSecrets('standup', {})).toEqual({})
  })

  it('forgetting a room we never knew is a no-op', () => {
    expect(() => forgetRoomSecrets('never-seen')).not.toThrow()
  })
})

describe('storage failures', () => {
  it('blocked storage degrades to "no memory", never to a crash', () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    // The link still works — it carries its own secrets. We just can't heal a
    // later fragment-less arrival, which is exactly the pre-existing behaviour.
    expect(resolveRoomSecrets('standup', { secret: '1.abc' })).toEqual({ secret: '1.abc' })
    expect(resolveRoomSecrets('standup', {})).toEqual({})
  })

  it('a corrupt entry is ignored rather than thrown on', () => {
    localStorage.setItem('mn.roomKeys', 'not json')
    expect(resolveRoomSecrets('standup', {})).toEqual({})
    // …and the next real link repairs it.
    expect(resolveRoomSecrets('standup', { secret: '1.abc' })).toEqual({ secret: '1.abc' })
    expect(recallRoomSecrets('standup')).toMatchObject({ secret: '1.abc' })
  })

  it('expires entries older than the TTL', () => {
    const stale = { standup: { secret: '1.abc', ts: Date.now() - 31 * 24 * 60 * 60 * 1000 } }
    localStorage.setItem('mn.roomKeys', JSON.stringify(stale))
    expect(recallRoomSecrets('standup')).toEqual({})
  })

  it('keeps the map bounded', () => {
    for (let i = 0; i < 40; i++) rememberRoomSecrets(`room-${i}`, { secret: `1.s${i}` })
    const map = JSON.parse(localStorage.getItem('mn.roomKeys')!)
    expect(Object.keys(map).length).toBeLessThanOrEqual(24)
    // Newest survive; oldest fall off.
    expect(map['room-39']).toBeTruthy()
    expect(map['room-0']).toBeUndefined()
  })
})

describe('isAuthFragment', () => {
  it('recognises what Supabase parks in the hash', () => {
    expect(isAuthFragment('#access_token=aaa&refresh_token=bbb')).toBe(true)
    expect(isAuthFragment('#error=access_denied&error_description=nope')).toBe(true)
    expect(isAuthFragment('#code=pkce')).toBe(true)
  })

  it('leaves a room fragment (and an empty one) alone', () => {
    expect(isAuthFragment('#k=1.abc&e=xyz')).toBe(false)
    expect(isAuthFragment('')).toBe(false)
  })
})
