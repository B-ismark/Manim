import { describe, it, expect } from 'vitest'
import { joinNames, reactorList, MAX_NAMED } from './reactors'

const ME = 'Ada#dev1'
const NAMES = { 'Ada#dev1': 'Ada', 'Kojo#dev2': 'Kojo', 'Ama#dev3': 'Ama' }

describe('reactorList', () => {
  it('puts you first, as "You"', () => {
    expect(reactorList([ME, 'Kojo#dev2'], NAMES, ME)).toEqual(['You', 'Kojo'])
  })

  it('leaves you out when the reaction is not yours', () => {
    expect(reactorList(['Kojo#dev2'], NAMES, ME)).toEqual(['Kojo'])
  })

  it('sorts the others by name, not by arrival order', () => {
    // Same set of people always reads the same way, whatever order the packets
    // landed in.
    expect(reactorList(['Kojo#dev2', 'Ama#dev3'], NAMES, ME)).toEqual(['Ama', 'Kojo'])
    expect(reactorList(['Ama#dev3', 'Kojo#dev2'], NAMES, ME)).toEqual(['Ama', 'Kojo'])
  })

  it('falls back to the identity prefix for a reactor we never heard a name for', () => {
    // A client too old to send one, or a reactor whose broadcast predates us.
    expect(reactorList(['Zoe#dev9'], {}, ME)).toEqual(['Zoe'])
  })

  it('never renders a blank name', () => {
    expect(reactorList(['#dev9'], {}, ME)).toEqual(['Guest'])
    expect(reactorList([''], {}, ME)).toEqual(['Guest'])
  })

  it('is empty for a reaction nobody holds', () => {
    expect(reactorList([], NAMES, ME)).toEqual([])
  })
})

describe('joinNames', () => {
  it('reads as a spoken list', () => {
    expect(joinNames(['You'])).toBe('You')
    expect(joinNames(['You', 'Kojo'])).toBe('You and Kojo')
    expect(joinNames(['You', 'Ama', 'Kojo'])).toBe('You, Ama and Kojo')
  })

  it('collapses the overflow instead of trailing a second "and"', () => {
    const many = ['You', 'A', 'B', 'C', 'D', 'E', 'F', 'G']
    expect(joinNames(many)).toBe('You, A, B, C, D and 3 more')
    // Exactly at the cap, nothing is collapsed.
    expect(joinNames(many.slice(0, MAX_NAMED))).toBe('You, A, B, C and D')
  })

  it('is empty for an empty list', () => {
    expect(joinNames([])).toBe('')
  })
})
