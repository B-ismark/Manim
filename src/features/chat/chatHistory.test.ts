import { describe, it, expect } from 'vitest'
import { readChatHistory } from './chatHistory'

describe('readChatHistory', () => {
  it('is on unless the host turned it off', () => {
    expect(readChatHistory(undefined)).toBe(true)
    expect(readChatHistory('{}')).toBe(true)
    expect(readChatHistory('{"chatHistory":true}')).toBe(true)
    expect(readChatHistory('{"chatHistory":false}')).toBe(false)
    expect(readChatHistory('not json')).toBe(true)
  })
})
