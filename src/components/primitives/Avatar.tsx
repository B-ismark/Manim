import { useMemo } from 'react'
import { cn } from '@/lib/cn'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const sizeClass: Record<Size, string> = {
  sm: 'size-8 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-3xl',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic hue from name so a person keeps the same color. */
function hueFromName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

export interface AvatarProps {
  name: string
  size?: Size
  className?: string
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const hue = useMemo(() => hueFromName(name || '?'), [name])
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold text-white shrink-0',
        sizeClass[size],
        className,
      )}
      style={{ backgroundColor: `oklch(0.6 0.13 ${hue})` }}
    >
      {initials(name)}
    </span>
  )
}
