/**
 * The Storage objects that can hold this account's photo: the one its URL names
 * (only when it's in our bucket, under this account's folder — a provider photo
 * is someone else's URL), plus the fixed name photos used to have.
 */
export function avatarObjects(userId: string, url: string | null): string[] {
  const out = [`${userId}/avatar.webp`]
  const marker = '/object/public/avatars/'
  const at = url ? url.indexOf(marker) : -1
  if (url && at >= 0) {
    const name = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0])
    if (name.startsWith(`${userId}/`) && !name.includes('..') && !out.includes(name)) out.push(name)
  }
  return out
}
