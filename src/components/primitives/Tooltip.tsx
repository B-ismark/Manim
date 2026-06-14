import * as RT from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Wrap the app once so tooltips share timing. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={400}>{children}</RT.Provider>
}

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={8}
          className={cn(
            'z-50 rounded-field bg-raised px-2.5 py-1.5 text-xs text-ink shadow-pop border border-line',
            'select-none mn-pop',
          )}
        >
          {content}
          <RT.Arrow className="fill-[var(--color-raised)]" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  )
}
