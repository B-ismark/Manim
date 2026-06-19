import { describe, it, expect } from 'vitest'
import { prettyRoom } from './roomName'

describe('prettyRoom', () => {
  it('turns a hyphenated slug into Title Case display', () => {
    expect(prettyRoom('world-cup')).toBe('World Cup')
  })

  it('handles underscores too', () => {
    expect(prettyRoom('team_standup')).toBe('Team Standup')
  })

  it('leaves numeric segments of generated codes intact', () => {
    expect(prettyRoom('calm-otter-417')).toBe('Calm Otter 417')
  })

  it('collapses repeated separators', () => {
    expect(prettyRoom('a--b__c')).toBe('A B C')
  })

  it('is stable on an already-pretty single word', () => {
    expect(prettyRoom('manim')).toBe('Manim')
  })

  it('does not throw on an empty string', () => {
    expect(prettyRoom('')).toBe('')
  })
})
