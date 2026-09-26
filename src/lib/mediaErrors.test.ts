import { describe, it, expect } from 'vitest'
import { mediaErrorMessage } from './mediaErrors'

const err = (name: string) => Object.assign(new Error('x'), { name })

describe('mediaErrorMessage', () => {
  it('tells a busy camera apart from a blocked one and a missing one', () => {
    expect(mediaErrorMessage(err('NotReadableError'), 'camera')).toMatch(/in use by another app/)
    expect(mediaErrorMessage(err('NotAllowedError'), 'camera')).toMatch(/blocked/)
    expect(mediaErrorMessage(err('NotFoundError'), 'camera')).toMatch(/No camera found/)
  })

  it('returns null for anything that is not a device failure', () => {
    // The classification half: these must stay fatal to the join.
    expect(mediaErrorMessage(err('ConnectionError'))).toBeNull()
    expect(mediaErrorMessage(new Error('could not establish pc connection'))).toBeNull()
    expect(mediaErrorMessage(null)).toBeNull()
  })
})
