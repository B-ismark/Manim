import { describe, it, expect } from 'vitest'
import { stripFragments } from './report'

describe('stripFragments', () => {
  it('drops room secrets from every URL in a report, however deep', () => {
    const event = {
      request: { url: 'https://manim.app/r/standup#k=1.abc&e=SECRETKEY' },
      breadcrumbs: [{ data: { from: '/', to: 'https://manim.app/r/x#e=KEY2' } }],
      message: 'failed at https://manim.app/r/y#k=Z while joining',
    }
    const out = JSON.stringify(stripFragments(event))
    expect(out).not.toMatch(/SECRETKEY|KEY2|#k=|#e=/)
    expect(out).toContain('https://manim.app/r/standup')
    expect(out).toContain('failed at https://manim.app/r/y while joining')
  })

  it('leaves reports without URLs untouched', () => {
    expect(stripFragments({ a: 1, b: 'plain #hashtag' })).toEqual({ a: 1, b: 'plain #hashtag' })
  })
})
