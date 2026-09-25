import { describe, it, expect } from 'vitest'
import { forgetPersonalData, PERSONAL_KEYS } from './localData'

function memory(entries: Record<string, string>) {
  const m = new Map(Object.entries(entries))
  return { m, removeItem: (k: string) => void m.delete(k) }
}

describe('forgetPersonalData', () => {
  it('drops room secrets, identity and the stored name, and keeps device preferences', () => {
    const s = memory({
      'mn.recentRooms': '[{"slug":"x","e2ee":"key"}]',
      'mn.roomKeys': '{}',
      'mn.seats': '{}',
      'manim-display-name': 'Ama',
      'manim-device-id': 'abcd1234',
      'mn.effects': '{"blur":1}',
      'mn.devicePrefs': '{}',
    })
    forgetPersonalData(s)
    for (const k of PERSONAL_KEYS) expect(s.m.has(k)).toBe(false)
    expect(s.m.has('mn.effects')).toBe(true)
    expect(s.m.has('mn.devicePrefs')).toBe(true)
  })
})
