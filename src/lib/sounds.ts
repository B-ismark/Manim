import { useSoundStore } from '@/store/useSoundStore'

/*
  Lightweight UI sound cues — fully synthesized with the Web Audio API, so there
  are NO audio assets to host/ship (lines up with the lightweight + free goals).
  Each cue is a short envelope of one or more oscillator tones. Respects the
  user's sound toggle (useSoundStore) and never throws.
*/

type OscType = 'sine' | 'triangle' | 'square' | 'sawtooth'
interface Tone {
  /** frequency in Hz */
  f: number
  /** start offset from now, seconds */
  t: number
  /** duration, seconds */
  d: number
  type?: OscType
  /** peak gain (0–1) */
  g?: number
}

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) ctx = new Ctor()
    // Autoplay policy: a call only starts after a click, so resume succeeds.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function play(tones: Tone[]) {
  if (!useSoundStore.getState().enabled) return
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime
  for (const tone of tones) {
    try {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = tone.type ?? 'sine'
      osc.frequency.value = tone.f
      const start = now + tone.t
      const peak = tone.g ?? 0.1
      // Exponential attack/decay reads softer than a linear ramp.
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.d)
      osc.connect(gain).connect(ac.destination)
      osc.start(start)
      osc.stop(start + tone.d + 0.05)
    } catch {
      /* ignore a single failed tone */
    }
  }
}

/** Named, contextual cues. Kept short and gentle so they don't fatigue. */
export const sounds = {
  /** Someone joined — two rising notes. */
  join: () => play([
    { f: 523.25, t: 0, d: 0.16, type: 'sine' },
    { f: 783.99, t: 0.1, d: 0.22, type: 'sine' },
  ]),
  /** Someone left — two falling notes, softer. */
  leave: () => play([
    { f: 587.33, t: 0, d: 0.16, g: 0.08 },
    { f: 392.0, t: 0.1, d: 0.24, g: 0.08 },
  ]),
  /** A hand was raised — single bright ping. */
  hand: () => play([{ f: 880, t: 0, d: 0.18, type: 'triangle', g: 0.09 }]),
  /** A reaction arrived — tiny blip. */
  reaction: () => play([{ f: 1046.5, t: 0, d: 0.1, type: 'triangle', g: 0.06 }]),
  /** New chat message — soft high blip. */
  message: () => play([{ f: 987.77, t: 0, d: 0.12, g: 0.05 }]),
  /** Meeting ended for everyone — low descending phrase. */
  end: () => play([
    { f: 440, t: 0, d: 0.18, g: 0.09 },
    { f: 329.63, t: 0.12, d: 0.2, g: 0.09 },
    { f: 261.63, t: 0.26, d: 0.3, g: 0.09 },
  ]),
}

export type SoundName = keyof typeof sounds
