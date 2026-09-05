import { describe, it, expect } from 'vitest'
import { settledFlags, countSettled } from './settle'

/** Stand-in for an orchestrator call: resolves to VOID, like `moderate` does. */
const ok = () => Promise.resolve().then(() => undefined)
const fail = () => Promise.reject(new Error('403'))

describe('settledFlags', () => {
  it('reports true for a request that resolved to undefined', async () => {
    // The regression this guards: orchestrator mutations are Promise<void>, so a
    // successful call resolves to `undefined`. Anything that counts the resolved
    // VALUE scores a success as falsy.
    expect(await settledFlags([ok()])).toEqual([true])
  })

  it('reports false for a rejected request', async () => {
    expect(await settledFlags([fail()])).toEqual([false])
  })

  it('reports false for a skipped slot', async () => {
    expect(await settledFlags([undefined])).toEqual([false])
  })

  it('does not reject when some jobs reject', async () => {
    await expect(settledFlags([ok(), fail(), undefined])).resolves.toEqual([true, false, false])
  })

  it('keeps flags in the order the jobs were given, not completion order', async () => {
    const slow = new Promise<void>((res) => setTimeout(res, 10))
    expect(await settledFlags([slow, ok(), fail()])).toEqual([true, true, false])
  })

  it('is empty for no jobs', async () => {
    expect(await settledFlags([])).toEqual([])
  })
})

describe('countSettled', () => {
  it('counts only the requests that actually succeeded', async () => {
    // Mute-all over four participants: two open mics muted, one already muted
    // (skipped), one rejected by the server.
    expect(await countSettled([ok(), ok(), undefined, fail()])).toBe(2)
  })

  it('is 0 when every target was skipped', async () => {
    expect(await countSettled([undefined, undefined])).toBe(0)
  })

  it('is 0 when every request failed', async () => {
    expect(await countSettled([fail(), fail()])).toBe(0)
  })

  it('distinguishes "nothing to do" from "everything worked"', async () => {
    // These two must not collapse to the same number — that collapse is exactly
    // what made Mute-all report "Everyone was already muted" after muting people.
    const nothing = await countSettled([undefined, undefined, undefined])
    const everything = await countSettled([ok(), ok(), ok()])
    expect(nothing).toBe(0)
    expect(everything).toBe(3)
  })
})
