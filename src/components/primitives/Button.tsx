import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'accent' | 'neutral' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-control select-none whitespace-nowrap ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 ' +
  'transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)] ' +
  'ease-[var(--ease-snap)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none'

const variantClass: Record<Variant, string> = {
  accent: 'bg-accent text-accent-ink hover:bg-accent-hover',
  neutral: 'bg-sunken text-ink hover:bg-line',
  ghost: 'bg-transparent text-ink hover:bg-sunken',
  danger: 'bg-danger text-danger-ink hover:bg-danger-hover',
}

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'neutral', size = 'md', block = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variantClass[variant], sizeClass[size], block && 'w-full', className)}
      {...rest}
    />
  )
})
