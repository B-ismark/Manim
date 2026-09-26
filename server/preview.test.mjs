import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { roomTitle, roomFromPath, rewriteHead } from './preview.mjs'

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const at = (pathname) => rewriteHead(INDEX, { origin: 'https://manim.example', pathname })

describe('roomTitle', () => {
  it('drops the random code from a generated room', () => {
    expect(roomTitle('swift-falcon-kq7mz3xhp2rtd')).toBe('Swift Falcon')
  })

  it('keeps a typed name whole, numbers included', () => {
    expect(roomTitle('team-standup')).toBe('Team Standup')
    expect(roomTitle('calm-otter-417')).toBe('Calm Otter 417')
  })

  it('reads percent-encoded non-Latin slugs', () => {
    expect(roomTitle(encodeURIComponent('会议'))).toBe('会议')
  })

  it('caps a very long name', () => {
    expect(Array.from(roomTitle('a'.repeat(200))).length).toBe(60)
  })
})

describe('roomFromPath', () => {
  it('matches only a room page', () => {
    expect(roomFromPath('/r/team-standup')).toBe('team-standup')
    expect(roomFromPath('/r/team-standup/')).toBe('team-standup')
    expect(roomFromPath('/')).toBeNull()
    expect(roomFromPath('/privacy')).toBeNull()
  })
})

describe('rewriteHead', () => {
  it('names the room in the card and keeps room pages out of search', () => {
    const html = at('/r/swift-falcon-kq7mz3xhp2rtd')
    expect(html).toContain('<title>Swift Falcon · Manim</title>')
    expect(html).toContain('<meta property="og:title" content="Swift Falcon · Manim" />')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(html).toContain('<meta property="og:url" content="https://manim.example/r/swift-falcon-kq7mz3xhp2rtd" />')
  })

  it('makes the preview image absolute', () => {
    expect(at('/')).toContain('content="https://manim.example/og.jpg"')
    expect(at('/')).not.toMatch(/og:image" content="\//)
  })

  it('leaves the landing page indexable with its own copy', () => {
    const html = at('/')
    expect(html).not.toContain('noindex')
    expect(html).toContain('<title>Manim — Video Calls</title>')
  })

  it('treats $ in a room name as text, not a replacement pattern', () => {
    const base = at('/').length
    for (const path of ['/r/a%24%60b', '/r/%24%26', "/r/%24'x"]) {
      const html = at(path)
      expect(html.match(/<title>/g)).toHaveLength(1)
      expect(html.match(/<!doctype/gi)).toHaveLength(1)
      expect(html.length).toBeLessThan(base + 1200)
    }
  })

  it('escapes whatever the slug contains', () => {
    const html = at(`/r/${encodeURIComponent('"><script>x</script>')}`)
    expect(html).not.toContain('<script>x')
  })
})
