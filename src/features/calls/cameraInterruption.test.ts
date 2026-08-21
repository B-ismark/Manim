import { describe, it, expect } from 'vitest'
import { isCaptureInterrupted, shouldRecoverCamera, type CaptureState } from './cameraInterruption'

const live: CaptureState = { readyState: 'live', muted: false }
const suspended: CaptureState = { readyState: 'live', muted: true } // the iOS background case
const dead: CaptureState = { readyState: 'ended', muted: false }

describe('isCaptureInterrupted', () => {
  it('a healthy capture is not interrupted', () => {
    expect(isCaptureInterrupted(live)).toBe(false)
  })

  it('a UA-muted capture is interrupted (iOS background)', () => {
    expect(isCaptureInterrupted(suspended)).toBe(true)
  })

  it('an ended capture is interrupted', () => {
    expect(isCaptureInterrupted(dead)).toBe(true)
  })

  it('no track at all is NOT an interruption — the camera is just off', () => {
    expect(isCaptureInterrupted(undefined)).toBe(false)
    expect(isCaptureInterrupted(null)).toBe(false)
  })
})

describe('shouldRecoverCamera', () => {
  const base = { cameraEnabled: true, pageVisible: true, busy: false, capture: suspended }

  it('recovers a suspended capture on a visible page with the camera on', () => {
    expect(shouldRecoverCamera(base)).toBe(true)
  })

  it('never turns a deliberately-off camera back on', () => {
    expect(shouldRecoverCamera({ ...base, cameraEnabled: false })).toBe(false)
  })

  it('waits for the foreground — getUserMedia cannot succeed while hidden', () => {
    expect(shouldRecoverCamera({ ...base, pageVisible: false })).toBe(false)
  })

  it('does not stack a second attempt on top of one in flight', () => {
    expect(shouldRecoverCamera({ ...base, busy: true })).toBe(false)
  })

  it('is a no-op on a healthy capture — which is why it needs no iOS check', () => {
    expect(shouldRecoverCamera({ ...base, capture: live })).toBe(false)
  })

  it('is a no-op when there is no camera track to recover', () => {
    expect(shouldRecoverCamera({ ...base, capture: undefined })).toBe(false)
  })

  it('recovers an ended capture too', () => {
    expect(shouldRecoverCamera({ ...base, capture: dead })).toBe(true)
  })
})
