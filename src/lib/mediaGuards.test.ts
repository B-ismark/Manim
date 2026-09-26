import { describe, it, expect } from 'vitest'
import { installMediaGuards, isMediaTarget } from './mediaGuards'

/** Minimal element stand-in: `closest('video')` walks a fake parent chain. */
interface FakeEl {
  tag: string
  parent?: FakeEl
  closest(sel: string): FakeEl | null
}
function el(tag: string, parent?: FakeEl): FakeEl {
  return {
    tag,
    parent,
    closest(sel) {
      for (let n: FakeEl | undefined = this; n; n = n.parent) if (n.tag === sel) return n
      return null
    },
  }
}

/** A document that records its capture listeners, so events can be dispatched by hand. */
function fakeDoc() {
  const listeners = new Map<string, (e: Event) => void>()
  return {
    listeners,
    addEventListener: (t: string, fn: (e: Event) => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
  }
}

function fire(doc: ReturnType<typeof fakeDoc>, type: string, target: unknown) {
  let prevented = false
  doc.listeners.get(type)?.({ target, preventDefault: () => (prevented = true) } as unknown as Event)
  return prevented
}

describe('isMediaTarget', () => {
  it('is true for a video and anything inside one', () => {
    const v = el('video')
    expect(isMediaTarget(v as unknown as EventTarget)).toBe(true)
    expect(isMediaTarget(el('div', v) as unknown as EventTarget)).toBe(true)
  })

  it('is false for ordinary elements and non-elements', () => {
    expect(isMediaTarget(el('button', el('div')) as unknown as EventTarget)).toBe(false)
    expect(isMediaTarget(null)).toBe(false)
    expect(isMediaTarget({} as EventTarget)).toBe(false)
  })
})

describe('installMediaGuards', () => {
  it('blocks the context menu and drag on a video, and nowhere else', () => {
    const doc = fakeDoc()
    installMediaGuards(doc as unknown as Document)
    expect(fire(doc, 'contextmenu', el('video'))).toBe(true)
    expect(fire(doc, 'dragstart', el('video'))).toBe(true)
    // Chat text, links and inputs keep their normal menu (copy, spellcheck…).
    expect(fire(doc, 'contextmenu', el('p'))).toBe(false)
  })

  it('removes its listeners on teardown', () => {
    const doc = fakeDoc()
    installMediaGuards(doc as unknown as Document)()
    expect(doc.listeners.size).toBe(0)
  })
})
