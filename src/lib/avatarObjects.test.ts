import { describe, it, expect } from 'vitest'
import { avatarObjects } from './avatarObjects'

describe('avatarObjects', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/avatars/'
  it('names the legacy object plus the one the URL points at', () => {
    expect(avatarObjects('u1', `${base}u1/abc.webp`)).toEqual(['u1/avatar.webp', 'u1/abc.webp'])
    expect(avatarObjects('u1', `${base}u1/avatar.webp?v=12`)).toEqual(['u1/avatar.webp'])
  })
  it('never touches another folder or a provider photo', () => {
    expect(avatarObjects('u1', `${base}u2/abc.webp`)).toEqual(['u1/avatar.webp'])
    expect(avatarObjects('u1', `${base}u1/../u2/abc.webp`)).toEqual(['u1/avatar.webp'])
    expect(avatarObjects('u1', 'https://lh3.googleusercontent.com/a/photo')).toEqual(['u1/avatar.webp'])
    expect(avatarObjects('u1', null)).toEqual(['u1/avatar.webp'])
  })
})
