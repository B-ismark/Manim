/**
 * A short 440 Hz tone, so you can check your speaker. Used by prejoin's "Test
 * speaker" and the in-call mic caret's "Play test sound".
 *
 * `sinkId` routes it to the speaker you picked rather than the system default —
 * otherwise the test proves the wrong device works. `AudioContext.setSinkId` is
 * Chromium-only; elsewhere the tone plays on the default output, which is also
 * where the call's audio goes when the browser can't route.
 */
export function playTestTone(sinkId?: string) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const routable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    const ready =
      sinkId && sinkId !== 'default' && routable.setSinkId
        ? routable.setSinkId(sinkId).catch(() => {})
        : Promise.resolve()
    void ready.then(() => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 440
      gain.gain.value = 0.08
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.35)
      osc.onended = () => void ctx.close().catch(() => {})
    })
  } catch {
    /* Web Audio unavailable */
  }
}
