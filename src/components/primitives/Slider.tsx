import * as RS from '@radix-ui/react-slider'
import { cn } from '@/lib/cn'

export interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  className?: string
}

/** Range control (Radix Slider) — e.g. background blur radius. */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  className,
}: SliderProps) {
  return (
    <RS.Root
      className={cn('relative flex h-5 w-full touch-none select-none items-center', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0])}
      aria-label={label}
    >
      <RS.Track className="relative h-1.5 w-full grow rounded-control bg-line">
        <RS.Range className="absolute h-full rounded-control bg-accent" />
      </RS.Track>
      <RS.Thumb
        className="block size-4 rounded-control bg-surface shadow-pop border border-line focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={label}
      />
    </RS.Root>
  )
}
