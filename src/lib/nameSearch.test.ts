import { describe, expect, it } from 'vitest'
import { nameMatches } from './nameSearch'

describe('nameMatches', () => {
  it('ignores case and accents', () => {
    expect(nameMatches('José Mensah', 'jose')).toBe(true)
    expect(nameMatches('Ama', 'AMA')).toBe(true)
    expect(nameMatches('Zoë', 'zoe')).toBe(true)
  })
  it('needs every word, in any order', () => {
    expect(nameMatches('Kofi Annan', 'annan kofi')).toBe(true)
    expect(nameMatches('Kofi Annan', 'kofi b')).toBe(false)
  })
  it('matches everyone for an empty or blank query', () => {
    expect(nameMatches('Ama', '')).toBe(true)
    expect(nameMatches('Ama', '   ')).toBe(true)
  })
  it('finds a part of a name', () => {
    expect(nameMatches('Abena Owusu', 'owu')).toBe(true)
  })
})
