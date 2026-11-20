import { describe, it, expect } from 'vitest'
import { writeWithRetry } from './queueWrite.mjs'
import { mutateQueue, enqueueOp, decideOp } from './core.mjs'
import { seal, unseal } from './sealed.mjs'

const SECRET = 'test-secret-that-is-long-enough-for-hmac'
const ROOM = 'race-room'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Small timings so the suite stays fast; the fake's latencies are below settleMs,
 *  as a real read→write gap is below the real one. */
const FAST = { attempts: 5, settleMs: 40, jitterMs: 10, backoffMs: 5 }

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
      ids.map((id) => mutateQueue(svc, SECRET, ROOM, enqueueOp(knock(id, id)), { config: { ...FAST, attempts: 8 } })),
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
      // Never both told "done" for contradictory outcomes unless the later one stands,
      // and whichever stands was told 200.
      if (status === 'approved') expect(yes.value.status).toBe(200)
      else expect(no.value.status).toBe(200)
      expect(['approved', 'denied']).toContain(status)
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

describe('writeWithRetry', () => {
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
