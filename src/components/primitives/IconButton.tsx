import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'accent' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const sizeClass: Record<Size, string> = {
  sm: 'size-9 [&_svg]:size-4',
  md: 'size-11 [&_svg]:size-5',
  lg: 'size-14 [&_svg]:size-6',
}

const toneIdle: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink hover:bg-line',
  accent: 'bg-accent text-accent-ink hover:bg-accent-hover',
  danger: 'bg-danger text-danger-ink hover:bg-danger-hover',
}

// "active" = toggled-on state (e.g. panel open). "off" = a muted/disabled-capability
// state used by mic/cam toggles, shown with the danger tone per convention.
const toneActive: Record<Tone, string> = {
  neutral: 'bg-accent text-accent-ink hover:bg-accent-hover',
  accent: 'bg-accent-hover text-accent-ink',
  danger: 'bg-danger text-danger-ink hover:bg-danger-hover',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — icon-only controls must be labeled (STYLE.md §6). */
  label: string
  icon: ReactNode
  tone?: Tone
  size?: Size
  active?: boolean
}

/** Round, icon-only control. Backbone of the control bar and toolbars. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'neutral', size = 'md', active = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-control',
        'transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-snap)]',
        'active:scale-[0.94] disabled:opacity-50 disabled:pointer-events-none',
        sizeClass[size],
        active ? toneActive[tone] : toneIdle[tone],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
})
