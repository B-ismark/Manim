import { describe, it, expect } from 'vitest'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderRichText, renderMarkdown } from './formatText'
import { encodeMentions, type MentionTarget } from '@/features/chat/mentions'

// No JSX in this file (keeps it independent of the test runner's JSX transform):
// render the nodes to static HTML and assert on the markup.
const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))

describe('renderMarkdown', () => {
  it('renders **bold**', () => {
    expect(html(renderMarkdown('a **b** c'))).toBe('a <strong>b</strong> c')
  })

  it('renders *italic* and _italic_', () => {
    expect(html(renderMarkdown('*i*'))).toBe('<em>i</em>')
    expect(html(renderMarkdown('_i_'))).toBe('<em>i</em>')
  })

  it('renders ~~strike~~', () => {
    expect(html(renderMarkdown('~~x~~'))).toBe('<s>x</s>')
  })

  it('renders `inline code` literally (no nested markdown)', () => {
    expect(html(renderMarkdown('`**not bold**`'))).toContain('<code')
    expect(html(renderMarkdown('`**not bold**`'))).toContain('**not bold**')
  })

  it('linkifies a URL and keeps trailing sentence punctuation out of the href', () => {
    const out = html(renderMarkdown('see https://x.com.'))
    expect(out).toContain('href="https://x.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    // The period stays as text, not in the link.
    expect(out).toMatch(/<\/a>\./)
  })

  it('nests bold inside the rendered output', () => {
    expect(html(renderMarkdown('**a *b* c**'))).toBe('<strong>a <em>b</em> c</strong>')
  })
})

describe('renderRichText — XSS safety', () => {
  it('renders an injection payload as literal text, never HTML', () => {
    const out = html(renderRichText('<img src=x onerror=alert(1)>'))
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('onerror=alert(1)>') // not live markup
  })
})

describe('renderRichText — mentions', () => {
  const targets: MentionTarget[] = [{ identity: 'id-jane', name: 'Jane' }]

  it('gives a self-mention the filled accent pill', () => {
    const enc = encodeMentions('hi @Jane', targets)
    const out = html(renderRichText(enc, 'id-jane'))
    expect(out).toContain('bg-accent')
    expect(out).toContain('@Jane')
  })

  it('gives someone else’s mention plain accent text (no pill background)', () => {
    const enc = encodeMentions('hi @Jane', targets)
    const out = html(renderRichText(enc, 'id-someone-else'))
    expect(out).toContain('text-accent')
    expect(out).not.toContain('bg-accent')
  })
})
