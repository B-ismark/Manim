/**
 * Verify-and-retry for read-modify-write of room metadata (the waiting-room queue).
 *
 * LiveKit room metadata is one string with no compare-and-swap, and on Workers two
 * requests in different isolates can interleave their read and their write. Then
 * the second write replaces the first and a change vanishes: two guests knock at
 * once and one is never queued, two hosts admit at once and one guest stays
 * pending. This doesn't make the write atomic; it closes that window in practice:
 *
 *   read → mutate → write → wait a beat → read again → is my change there?
 *                                                       no → back off, redo it
 *
 * Why wait before checking, rather than checking at once: the writer that erases
 * yours is one that READ before your write landed and writes after it. Checking
 * straight away can happen before that later write lands, see your change and
 * report success, and then it's gone. That later write lands within one of its own
 * read→write gaps of yours (unseal + seal + one LiveKit round trip), so checking
 * after a settle delay longer than that catches it. The other writer runs the same
 * loop, so whichever of you lost redoes its change ON TOP of the winner's, and both
 * survive.
 *
 * `mutate(flags, attempt)` gets a FRESH copy each attempt and returns either
 * `{ patch, result }` (write `{...flags, ...patch}`, then verify) or `{ done }` (stop
 * now with `done` as the answer, writing nothing: already applied, or no longer
 * applicable). It must be idempotent across attempts: it always starts from the
 * re-read state, never from what an earlier attempt computed.
 */

export const QUEUE_WRITE = {
  /** Total read-modify-write attempts before giving up. */
  attempts: 5,
  /** Wait after a write before reading it back (see above), plus up to `jitterMs`. */
  settleMs: 250,
  jitterMs: 100,
  /** Pause before attempt n (n ≥ 1) is `backoffMs * n` plus up to `jitterMs`. */
  backoffMs: 60,
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {object} o
 * @param {() => Promise<object>} o.read          fresh room flags; must THROW on failure,
 *                                                never return {} (that would write over
 *                                                every other key)
 * @param {(flags: object) => Promise<void>} o.write  write the whole flags object
 * @param {(flags: object, attempt: number) => Promise<{patch?: object, result?: any, done?: any}>} o.mutate
 * @param {(flags: object) => Promise<boolean>} o.verify  is this request's change present?
 * @param {object} [o.first]                      already-fresh flags for attempt 0 (skips a read)
 * @returns {Promise<{ ok: true, value: any } | { ok: false }>}
 */
export async function writeWithRetry({ read, write, mutate, verify, first, sleep = realSleep, random = Math.random, config = QUEUE_WRITE }) {
  const jitter = () => Math.floor(random() * config.jitterMs)
  for (let attempt = 0; attempt < config.attempts; attempt++) {
    if (attempt > 0) await sleep(config.backoffMs * attempt + jitter())
    let step
    try {
      const flags = attempt === 0 && first ? first : await read()
      step = await mutate(flags, attempt)
      if ('done' in step) return { ok: true, value: step.done }
      await write({ ...flags, ...step.patch })
    } catch {
      // A failed read or write: nothing was (knowingly) changed. Try again.
      continue
    }
    await sleep(config.settleMs + jitter())
    try {
      if (await verify(await read())) return { ok: true, value: step.result }
    } catch {
      // Couldn't read it back. The write may well have landed; the next attempt
      // starts from a fresh read, and mutate's `done` path recognises it there.
    }
  }
  return { ok: false }
}
