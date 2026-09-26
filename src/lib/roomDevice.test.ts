import { describe, it, expect } from 'vitest'
import { roomDeviceId } from './roomDevice'

describe('roomDeviceId', () => {
  it('is stable per room, differs across rooms, and hides the original', async () => {
    const a = await roomDeviceId('dev-abc123', 'swift-falcon')
    expect(a).toBe(await roomDeviceId('dev-abc123', 'swift-falcon'))
    expect(a).not.toBe(await roomDeviceId('dev-abc123', 'calm-otter'))
    expect(a).not.toBe(await roomDeviceId('dev-xyz', 'swift-falcon'))
    expect(a).toMatch(/^[0-9a-f]{20}$/)
    expect(a).not.toContain('abc123')
  })
})
