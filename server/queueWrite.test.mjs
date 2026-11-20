import { describe, it, expect } from 'vitest'
import { writeWithRetry, QUEUE_WRITE } from './queueWrite.mjs'
import { mutateQueue, enqueueOp, decideOp, mutateRoomFlags, setFlagsOp, electOp, rememberRemovedOp, FLAG_REV } from './core.mjs'
import { removedEntry, wasRemoved } from './removed.mjs'
import { seal, unseal } from './sealed.mjs'

const SECRET = 'test-secret-that-is-long-enough-for-hmac'
const ROOM = 'race-room'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Small timings so the suite stays fast; the fake's latencies are below settleMs,
 *  as a real read→write gap is below the real one. */
const FAST = { attempts: QUEUE_WRITE.attempts, settleMs: 40, jitterMs: 10, backoffMs: 5 }

/**
 * A stand-in for LiveKit's RoomServiceClient: one metadata string, no CAS. A read
 * answers with the value at the moment it arrives and takes `readMs` to return; a
 * write lands `writeMs` after it's sent and replaces the whole string. That is all
 * it takes for two read-modify-writes to interleave and the later one to erase the
 * earlier.
 */
function fakeRoomService(initial, { readMs = 5, writeMs = 5, failReads = 0 } = {}) {
  let metadata = JSON.stringify(initial)
  let reads = 0
  const writes = []
  return {
    writes,
    get flags() {
      return JSON.parse(metadata)
    },
    async listRooms() {
      reads++
      if (reads <= failReads) throw new Error('twirp error: unavailable')
      const snapshot = metadata
      await wait(readMs)
      return [{ metadata: snapshot }]
    },
    async updateRoomMetadata(_room, m) {
      await wait(typeof writeMs === 'function' ? writeMs() : writeMs)
      metadata = m
      writes.push(JSON.parse(m))
    },
  }
}

async function queueOf(svc) {
  return unseal(SECRET, ROOM, svc.flags.queueSealed, [])
}

async function roomWith(queue, extra = {}) {
  return { hostId: 'Host#h1', locked: true, ...extra, queueSealed: await seal(SECRET, ROOM, queue) }
}

const knock = (id, name) => ({ id, name, deviceId: `dev-${id}`, userId: '', status: 'pending', ts: Date.now() })

describe('the fake room interleaves (control: plain read-modify-write loses one)', () => {
  it('two knocks at once without verify leave one entry', async () => {
    const svc = fakeRoomService(await roomWith([]))
    // attempts: 1 and a verify that always passes = the old mergeRoomFlags path.
    const naive = { ...FAST, attempts: 1 }
    const run = (e) =>
      writeWithRetry({
        config: naive,
        read: async () => JSON.parse((await svc.listRooms())[0].metadata),
        write: (f) => svc.updateRoomMetadata(ROOM, JSON.stringify(f)),
        mutate: async (flags) => {
          const q = await unseal(SECRET, ROOM, flags.queueSealed, [])
          q.push(e)
          return { patch: { queueSealed: await seal(SECRET, ROOM, q) }, result: true }
        },
        verify: async () => true,
      })
    await Promise.all([run(knock('a', 'Esi')), run(knock('b', 'Kwame'))])
    expect((await queueOf(svc)).map((e) => e.id)).toHaveLength(1)
  })
})

describe('mutateQueue', () => {
  it('two guests knocking at the same moment both end up queued', async () => {
    const svc = fakeRoomService(await roomWith([]))
    const [a, b] = await Promise.all(
      [knock('a', 'Esi'), knock('b', 'Kwame')].map((e) => mutateQueue(svc, SECRET, ROOM, enqueueOp(e), { config: FAST })),
    )
    expect(a.ok && b.ok).toBe(true)
    expect((await queueOf(svc)).map((e) => e.id).sort()).toEqual(['a', 'b'])
    // A retry happened: more writes than knocks.
    expect(svc.writes.length).toBeGreaterThan(2)
  })

  it('a burst of five simultaneous knocks keeps all five', async () => {
    const svc = fakeRoomService(await roomWith([]), { writeMs: () => 2 + Math.floor(Math.random() * 8) })
    const ids = ['a', 'b', 'c', 'd', 'e']
    const res = await Promise.all(
      ids.map((id) => mutateQueue(svc, SECRET, ROOM, enqueueOp(knock(id, id)), { config: FAST })),
    )
    expect(res.every((r) => r.ok)).toBe(true)
    expect((await queueOf(svc)).map((e) => e.id).sort()).toEqual(ids)
  })

  it('catches a write that lands AFTER ours was first seen (why it waits before checking)', async () => {
    // B is slow to write: it read before A wrote and lands after A's write. Checking
    // straight after writing would have seen A's entry and stopped; the settle
    // delay outlasts B's gap, so A sees itself erased and re-adds itself.
    let n = 0
    const svc = fakeRoomService(await roomWith([]), { writeMs: () => (n++ === 1 ? 25 : 2) })
    await Promise.all([
      mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('a', 'Esi')), { config: FAST }),
      mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('b', 'Kwame')), { config: FAST }),
    ])
    expect((await queueOf(svc)).map((e) => e.id).sort()).toEqual(['a', 'b'])
  })

  it('a host and a co-host admitting different guests at once both stick', async () => {
    const svc = fakeRoomService(await roomWith([knock('a', 'Esi'), knock('b', 'Kwame')]))
    const [x, y] = await Promise.all([
      mutateQueue(svc, SECRET, ROOM, decideOp('a', true, 'Esi'), { config: FAST }),
      mutateQueue(svc, SECRET, ROOM, decideOp('b', true, 'Kwame'), { config: FAST }),
    ])
    expect(x.value.status).toBe(200)
    expect(y.value.status).toBe(200)
    const q = await queueOf(svc)
    expect(q.map((e) => e.status)).toEqual(['approved', 'approved'])
  })

  it('a knock racing an admit keeps both', async () => {
    const svc = fakeRoomService(await roomWith([knock('a', 'Esi')]))
    await Promise.all([
      mutateQueue(svc, SECRET, ROOM, decideOp('a', true, 'Esi'), { config: FAST }),
      mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('b', 'Kwame')), { config: FAST }),
    ])
    const q = await queueOf(svc)
    expect(q.find((e) => e.id === 'a')?.status).toBe('approved')
    expect(q.find((e) => e.id === 'b')?.status).toBe('pending')
  })

  it('opposite decisions on one guest: the outcome matches what each host was told', async () => {
    for (let i = 0; i < 10; i++) {
      const svc = fakeRoomService(await roomWith([knock('a', 'Esi')]), { writeMs: () => 1 + Math.floor(Math.random() * 6) })
      const [yes, no] = await Promise.all([
        mutateQueue(svc, SECRET, ROOM, decideOp('a', true, 'Esi'), { config: FAST }),
        mutateQueue(svc, SECRET, ROOM, decideOp('a', false), { config: FAST }),
      ])
      const status = (await queueOf(svc))[0].status
      expect(['approved', 'denied']).toContain(status)
      // Whichever stands was told 200; the other host was told it lost, never 200.
      const [won, lost] = status === 'approved' ? [yes, no] : [no, yes]
      expect(won.value.status).toBe(200)
      expect(lost.value).toMatchObject({ status: 409, body: { code: 'decided' } })
    }
  })

  it('carries every other key along, as mergeRoomFlags does', async () => {
    const svc = fakeRoomService(await roomWith([], { coHosts: ['Ama#d2'], waiting: true }))
    await Promise.all([
      mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('a', 'Esi')), { config: FAST }),
      mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('b', 'Kwame')), { config: FAST }),
    ])
    expect(svc.flags).toMatchObject({ hostId: 'Host#h1', locked: true, coHosts: ['Ama#d2'], waiting: true })
    expect('queue' in svc.flags).toBe(false)
  })

  it('a failed read never becomes a write of {} over the room', async () => {
    const svc = fakeRoomService(await roomWith([]), { failReads: 1 })
    const r = await mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('a', 'Esi')), { config: FAST })
    expect(r.ok).toBe(true)
    for (const w of svc.writes) expect(w.hostId).toBe('Host#h1')
  })

  it('still prunes stale entries before the 50-cap', async () => {
    const old = Array.from({ length: 60 }, (_, i) => ({ ...knock(`old${i}`, 'x'), ts: Date.now() - 60 * 60_000 }))
    const svc = fakeRoomService(await roomWith(old))
    await mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('fresh', 'Esi')), { config: FAST })
    expect((await queueOf(svc)).map((e) => e.id)).toEqual(['fresh'])
  })

  it('a retried decision respects a rename made while it was lost', async () => {
    const op = decideOp('a', true, 'Esi')
    const q = [{ ...knock('a', 'Esii') }]
    expect(op.change(q, 1)).toMatchObject({ done: { status: 409, body: { code: 'renamed' } } })
    // Attempt 0 is the handler's own path, which checked the name already.
    expect(op.change([{ ...knock('a', 'Esi') }], 0)).toMatchObject({ result: { status: 200 } })
  })
})

describe('mutateRoomFlags', () => {
  const toggle = (svc, patch, extra = {}) => mutateRoomFlags(svc, ROOM, setFlagsOp(patch, extra), { config: FAST })

  it('a host toggle racing a knock: both survive', async () => {
    for (let i = 0; i < 5; i++) {
      const svc = fakeRoomService(await roomWith([], { locked: false }), { writeMs: () => 1 + Math.floor(Math.random() * 6) })
      const [t, k] = await Promise.all([
        toggle(svc, { waiting: true }),
        mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('a', 'Esi')), { config: FAST }),
      ])
      expect(t).toEqual({ ok: true, value: true })
      expect(k.ok).toBe(true)
      expect(svc.flags.waiting).toBe(true)
      expect((await queueOf(svc)).map((e) => e.id)).toEqual(['a'])
    }
  })

  it('a removal racing an admit: the removed guest stays removed, the admitted one admitted', async () => {
    for (let i = 0; i < 5; i++) {
      const svc = fakeRoomService(await roomWith([knock('a', 'Esi')]), { writeMs: () => 1 + Math.floor(Math.random() * 6) })
      const entry = await removedEntry('Kofi#dev-kofi', '')
      const [r, a] = await Promise.all([
        mutateRoomFlags(svc, ROOM, rememberRemovedOp(entry), { config: FAST }),
        mutateQueue(svc, SECRET, ROOM, decideOp('a', true, 'Esi'), { config: FAST }),
      ])
      expect(r.ok).toBe(true)
      expect(a.value.status).toBe(200)
      expect(await wasRemoved(svc.flags.removed, 'dev-kofi', '')).toBe(true)
      expect((await queueOf(svc))[0].status).toBe('approved')
    }
  })

  it('two different toggles at once both stick', async () => {
    const svc = fakeRoomService(await roomWith([], { locked: false }))
    await Promise.all([toggle(svc, { locked: true }), toggle(svc, { chatHistory: false })])
    expect(svc.flags).toMatchObject({ locked: true, chatHistory: false, hostId: 'Host#h1' })
  })

  it('two hosts flipping one switch opposite ways settle on one answer instead of fighting', async () => {
    for (let i = 0; i < 10; i++) {
      const svc = fakeRoomService(await roomWith([], { locked: false }), { writeMs: () => 1 + Math.floor(Math.random() * 6) })
      const [on, off] = await Promise.all([toggle(svc, { locked: true }), toggle(svc, { locked: false })])
      expect(on.ok && off.ok).toBe(true)
      expect(typeof svc.flags.locked).toBe('boolean')
      // Neither kept redoing itself: a fight would run to the attempt limit.
      expect(svc.writes.length).toBeLessThan(5)
    }
  })

  it('a later deliberate change counts as kept; only a reverted tag is redone', () => {
    const op = setFlagsOp({ locked: true }, { tag: 'mine' })
    const base = { hostId: 'H', locked: false, [FLAG_REV]: { locked: 'old' } }
    expect(op.change(base, 0)).toEqual({ patch: { locked: true, [FLAG_REV]: { locked: 'mine' } }, result: true })
    // A stale write put the old tag back: lost, redo it.
    expect(op.present(base)).toBe(false)
    expect(op.change(base, 1)).toMatchObject({ patch: { locked: true } })
    // Another host set it since (their own tag): theirs stands.
    const theirs = { ...base, [FLAG_REV]: { locked: 'theirs' } }
    expect(op.present(theirs)).toBe(true)
    expect(op.change(theirs, 1)).toEqual({ done: true })
  })

  it('a retry re-checks authority on the fresh flags', () => {
    const op = setFlagsOp({ locked: true }, { guard: (f) => (f.coHosts?.includes('Ama#d2') ? undefined : 403) })
    expect(op.change({ coHosts: ['Ama#d2'] }, 0)).toMatchObject({ result: true })
    expect(op.change({ coHosts: [] }, 1)).toEqual({ done: 403 })
  })

  it('host election racing a knock: the seat moves and the knock stays queued', async () => {
    for (let i = 0; i < 5; i++) {
      const svc = fakeRoomService(await roomWith([], { coHosts: ['Ama#d2', 'Yaw#d3'] }), { writeMs: () => 1 + Math.floor(Math.random() * 6) })
      const [e] = await Promise.all([
        mutateRoomFlags(svc, ROOM, electOp('Ama#d2', 'Host#h1'), { config: FAST }),
        mutateQueue(svc, SECRET, ROOM, enqueueOp(knock('a', 'Esi')), { config: FAST }),
      ])
      expect(e).toEqual({ ok: true, value: 'Ama#d2' })
      expect(svc.flags).toMatchObject({ hostId: 'Ama#d2', coHosts: ['Yaw#d3'] })
      expect((await queueOf(svc)).map((x) => x.id)).toEqual(['a'])
    }
  })

  it('concurrent elections that picked differently agree on the first that landed', async () => {
    const svc = fakeRoomService(await roomWith([], { coHosts: ['Ama#d2', 'Yaw#d3'] }))
    const [x, y] = await Promise.all([
      mutateRoomFlags(svc, ROOM, electOp('Ama#d2', 'Host#h1'), { config: FAST }),
      mutateRoomFlags(svc, ROOM, electOp('Yaw#d3', 'Host#h1'), { config: FAST }),
    ])
    expect(x.ok && y.ok).toBe(true)
    expect(x.value).toBe(svc.flags.hostId)
    expect(y.value).toBe(svc.flags.hostId)
    expect(svc.flags.coHosts).not.toContain(svc.flags.hostId)
  })

  it('a failed read is retried, never written as {} over the room', async () => {
    const svc = fakeRoomService(await roomWith([]), { failReads: 1 })
    const r = await toggle(svc, { locked: false })
    expect(r.ok).toBe(true)
    for (const w of svc.writes) expect(w.hostId).toBe('Host#h1')
  })

  it('removing the same device twice records it once', async () => {
    const entry = await removedEntry('Kofi#dev-kofi', '')
    const svc = fakeRoomService(await roomWith([], { removed: [entry] }))
    const r = await mutateRoomFlags(svc, ROOM, rememberRemovedOp(entry), { config: FAST })
    expect(r).toEqual({ ok: true, value: true })
    expect(svc.writes).toHaveLength(0)
  })
})

describe('writeWithRetry', () => {
  it('reports a write it could not read back as done, not busy', async () => {
    let reads = 0
    const r = await writeWithRetry({
      config: FAST,
      sleep: async () => {},
      first: {},
      read: async () => {
        reads++
        throw new Error('twirp error: unavailable')
      },
      write: async () => {},
      mutate: async () => ({ patch: {}, result: 'queued' }),
      verify: async () => true,
    })
    expect(r).toEqual({ ok: true, value: 'queued' })
    expect(reads).toBeGreaterThan(0)
  })

  it('gives up after its attempts when the change never sticks', async () => {
    let writes = 0
    const r = await writeWithRetry({
      config: FAST,
      sleep: async () => {},
      read: async () => ({}),
      write: async () => {
        writes++
      },
      mutate: async () => ({ patch: {}, result: 1 }),
      verify: async () => false,
    })
    expect(r).toEqual({ ok: false })
    expect(writes).toBe(FAST.attempts)
  })

  it('stops without writing when mutate says it is already done', async () => {
    let writes = 0
    const r = await writeWithRetry({
      config: FAST,
      sleep: async () => {},
      read: async () => ({}),
      write: async () => {
        writes++
      },
      mutate: async () => ({ done: 'already' }),
      verify: async () => true,
    })
    expect(r).toEqual({ ok: true, value: 'already' })
    expect(writes).toBe(0)
  })

  it('uses `first` for attempt 0 and a fresh read after that', async () => {
    const seen = []
    let reads = 0
    await writeWithRetry({
      config: FAST,
      sleep: async () => {},
      first: { from: 'first' },
      read: async () => ({ from: `read${++reads}` }),
      write: async () => {},
      mutate: async (flags) => {
        seen.push(flags.from)
        return { patch: {}, result: 1 }
      },
      verify: async () => reads >= 3,
    })
    // read1 = verify of attempt 0, read2 = attempt 1's fresh read, read3 = its verify.
    expect(seen).toEqual(['first', 'read2'])
  })
})
