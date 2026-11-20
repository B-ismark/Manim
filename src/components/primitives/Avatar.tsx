import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const sizeClass: Record<Size, string> = {
  // A face in a stack (the end-of-call "who was there"): one letter fits, two don't.
  xs: 'size-6 text-[11px]',
  sm: 'size-8 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-3xl',
}

/** First characters by code point, not UTF-16 unit: `'😀'.slice(0, 1)` is half a
 *  surrogate pair, which rendered as a broken glyph for any emoji-led name. */
const chars = (s: string, n: number) => Array.from(s).slice(0, n).join('')

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return chars(parts[0], 2).toUpperCase()
  return (chars(parts[0], 1) + chars(parts[parts.length - 1], 1)).toUpperCase()
}

/**
 * Lightness of the initials' background. White initials need 4.5:1 (WCAG AA,
 * small text). At 0.6 the cyan–teal hues fell to 3.57:1 — axe flagged it once
 * People was scanned with a "Benjamín" in it. 0.52 is the brightest that clears
 * 4.5 on EVERY hue at this chroma (worst 4.87:1, hue ~191); Avatar.test.ts
 * re-computes all 360 so a tweak can't quietly drop below.
 */
export const AVATAR_L = 0.52
export const AVATAR_C = 0.13

/** Deterministic hue from name so a person keeps the same color. */
function hueFromName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

export interface AvatarProps {
  name: string
  /** Profile photo URL. Falls back to coloured initials when absent or it fails to load. */
  src?: string | null
  size?: Size
  className?: string
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const hue = useMemo(() => hueFromName(name || '?'), [name])
  // Fall back to initials if the image 404s / is blocked (stale storage URL, etc.).
  const [broken, setBroken] = useState(false)

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        onError={() => setBroken(true)}
        draggable={false}
        className={cn(
          'inline-block rounded-control object-cover shrink-0',
          sizeClass[size],
          className,
        )}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold text-white shrink-0',
        sizeClass[size],
        className,
      )}
      style={{ backgroundColor: `oklch(${AVATAR_L} ${AVATAR_C} ${hue})` }}
    >
      {size === 'xs' ? chars(initials(name), 1) : initials(name)}
    </span>
  )
}
