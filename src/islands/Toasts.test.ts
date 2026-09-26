import { describe, it, expect } from 'vitest'
import { toastLife } from './Toasts'

describe('toastLife', () => {
  it('keeps a short neutral toast brief', () => {
    expect(toastLife({ tone: 'neutral', text: 'Ama joined' })).toBe(4000)
  })

  it('gives warnings and errors longer, and long text longer still', () => {
    expect(toastLife({ tone: 'danger', text: 'x' })).toBeGreaterThan(toastLife({ tone: 'neutral', text: 'x' }))
    const e2ee = "Encryption couldn't be turned on — this call is NOT end-to-end encrypted. Share a fresh link."
    expect(toastLife({ tone: 'danger', text: e2ee })).toBeGreaterThan(5000)
  })

  it('honours an explicit duration', () => {
    expect(toastLife({ tone: 'danger', text: 'x', duration: 1500 })).toBe(1500)
  })
})
