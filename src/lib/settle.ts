/**
 * Per-target success flags for a fan-out of fire-and-forget requests.
 *
 * The trap this exists to close: the orchestrator's mutating calls (`moderate`,
 * `setRoomFlags`, `endRoom`) are all declared `Promise<void>` — they end in
 * `.then(() => undefined)`. So their RESOLVED VALUE can never be the signal;
 * only fulfilment-vs-rejection can. Counting them with the obvious
 *
 *     await Promise.all(jobs.map((j) => j.catch(() => {})))   // ← always falsy
 *
 * yields `undefined` on BOTH paths, so `.filter(Boolean).length` is permanently
 * 0 and any "we changed N things" message silently degrades to "we changed
 * nothing". That shipped once in ParticipantsPanel's Mute-all.
 *
 * `undefined` entries mean "skipped, there was nothing to do" and stay `false` —
 * distinct from a request that ran and failed, but identical for counting how
 * many things actually changed.
 */
export function settledFlags(jobs: Array<Promise<unknown> | undefined>): Promise<boolean[]> {
  return Promise.all(
    jobs.map((job) =>
      job === undefined
        ? Promise.resolve(false)
        : job.then(
            () => true,
            () => false,
          ),
    ),
  )
}

/** How many of a fan-out actually succeeded. */
export async function countSettled(
  jobs: Array<Promise<unknown> | undefined>,
): Promise<number> {
  return (await settledFlags(jobs)).filter(Boolean).length
}
