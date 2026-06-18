import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-sunken text-success',
  danger: 'bg-sunken text-danger-text',
  warning: 'bg-sunken text-warning',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-xs font-medium',
        toneClass[tone],
        className,
      )}
      {...rest}
    />
  )
}
