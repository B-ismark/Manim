import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CSP } from './headers.mjs'

describe('security headers', () => {
  it('public/_headers carries the same CSP as the Worker', () => {
    const file = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    const line = file.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:'))
    expect(line?.trim().slice('Content-Security-Policy:'.length).trim()).toBe(CSP)
  })
})
