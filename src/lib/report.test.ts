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

  it('scrubs relative URLs, which is how navigation breadcrumbs record in-app moves', () => {
    const out = stripFragments({ data: { from: '/', to: '/r/a#k=1&e=KEY' } })
    expect(out).toEqual({ data: { from: '/', to: '/r/a' } })
  })

  it('scrubs a URL quoted inside a message (the old JSON pass failed open here)', () => {
    const out = stripFragments({ message: 'Navigation to "https://m.app/r/a#k=1&e=KEY" failed' })
    expect(out.message).toBe('Navigation to "https://m.app/r/a" failed')
  })

  it('stops at the end of the URL instead of eating the text after it', () => {
    const out = stripFragments({ stack: 'at /r/a#k=1&e=KEY\nnext line (x.js:1)' })
    expect(out.stack).toBe('at /r/a\nnext line (x.js:1)')
  })

  it('scrubs sign-in tokens and a bare hash, and survives cycles', () => {
    const e: Record<string, unknown> = { hash: '#access_token=abc&type=recovery', frag: '#e=KEY' }
    e.self = e
    const out = stripFragments(e) as Record<string, unknown>
    expect(out.hash).toBe('')
    expect(out.frag).toBe('')
    expect(out.self).toBe(out)
  })

  it('scrubs a room link percent-encoded inside another URL, and keeps the rest of the query', () => {
    const url = 'https://x.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fm.app%2Fr%2Fa%23k%3D1%26e%3DKEY&x=1'
    expect(stripFragments({ url }).url).toBe('https://x.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fm.app%2Fr%2Fa&x=1')
    expect(stripFragments({ c: '/q?to=%2Fdocs%23section' }).c).toBe('/q?to=%2Fdocs%23section')
  })

  it('redacts a token in a query string (livekit-client validates the join URL with one)', () => {
    const url = 'https://lk.example/rtc/v1/validate?access_token=eyJ.a-b_c.d&auto_subscribe=1'
    expect(stripFragments({ url }).url).toBe('https://lk.example/rtc/v1/validate?access_token=[redacted]&auto_subscribe=1')
    expect(stripFragments({ m: 'GET /x?a=1&token=abc failed' }).m).toBe('GET /x?a=1&token=[redacted] failed')
    expect(stripFragments({ q: '/q?to=%2Fr%3Faccess_token%3DJWT' }).q).toBe('/q?to=%2Fr%3Faccess_token%3D[redacted]')
    expect(stripFragments({ t: 'the token was fine' }).t).toBe('the token was fine')
  })

  it('leaves reports without secrets untouched', () => {
    expect(stripFragments({ a: 1, b: 'plain #hashtag', c: '/docs#section', d: null })).toEqual({
      a: 1,
      b: 'plain #hashtag',
      c: '/docs#section',
      d: null,
    })
  })
})
