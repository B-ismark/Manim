import * as RT from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem {
  value: string
  label: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
}

/**
 * Segmented tab control with token-styled triggers. Used to combine Chat /
 * People into one SidePanel (Slack model). Radix handles roving focus + ARIA.
 */
export function Tabs({ items, value, onValueChange, children, className }: TabsProps) {
  return (
    <RT.Root value={value} onValueChange={onValueChange} className={cn('flex flex-col', className)}>
      <RT.List className="flex shrink-0 gap-1 rounded-control bg-sunken p-1">
        {items.map((it) => (
          <RT.Trigger
            key={it.value}
            value={it.value}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium',
              'transition-colors duration-[var(--dur-fast)] outline-none',
              'text-ink-muted hover:text-ink',
              'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-raised',
              '[&_svg]:size-4',
            )}
          >
            {it.label}
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  )
}

export interface TabPanelProps {
  value: string
  children: ReactNode
  className?: string
}

/** A content panel paired with a Tabs trigger of the same value. */
export function TabPanel({ value, children, className }: TabPanelProps) {
  return (
    <RT.Content value={value} className={cn('flex-1 outline-none data-[state=inactive]:hidden', className)}>
      {children}
    </RT.Content>
  )
}
