import * as RDM from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface DropdownMenuProps {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Fires on open/close — e.g. to pin auto-hiding chrome while the menu shows. */
  onOpenChange?: (open: boolean) => void
  className?: string
}

/** Action menu (per-participant moderation, device pickers). Radix handles a11y + keyboard. */
export function DropdownMenu({
  trigger,
  children,
  side = 'bottom',
  align = 'end',
  onOpenChange,
  className,
}: DropdownMenuProps) {
  return (
    // Non-modal: a modal menu `aria-hidden`s the rest of the page (control bar,
    // top bar, stage) while it's open, but those still hold focusable buttons —
    // axe flags that as `aria-hidden-focus` (serious), and it's a real AT trap.
    // An action menu doesn't need modal semantics; Radix still moves focus into it,
    // closes on Esc / outside-click, and supports arrow-key navigation.
    <RDM.Root onOpenChange={onOpenChange} modal={false}>
      <RDM.Trigger asChild>{trigger}</RDM.Trigger>
      <RDM.Portal>
        <RDM.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 min-w-48 rounded-island bg-raised text-ink shadow-pop border border-line p-1.5 mn-pop',
            'focus:outline-none',
            className,
          )}
        >
          {children}
        </RDM.Content>
      </RDM.Portal>
    </RDM.Root>
  )
}

export interface DropdownItemProps {
  children: ReactNode
  onSelect?: () => void
  icon?: ReactNode
  tone?: 'neutral' | 'danger'
  disabled?: boolean
}

/** A single row in a DropdownMenu. */
export function DropdownItem({ children, onSelect, icon, tone = 'neutral', disabled }: DropdownItemProps) {
  return (
    <RDM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-field px-2.5 py-2 text-sm outline-none select-none',
        // 44px on a coarse pointer (audit F6) — these rows are ~36px, which clears
        // WCAG 2.5.8 but not the iOS/Android guidance, and a menu item is a thumb
        // target on touch. Mouse rows stay compact.
        'pointer-coarse:min-h-11',
        'data-[highlighted]:bg-sunken data-[disabled]:opacity-40 data-[disabled]:pointer-events-none',
        tone === 'danger' ? 'text-danger-text' : 'text-ink',
        '[&_svg]:size-4 [&_svg]:shrink-0',
      )}
    >
      {icon}
      {children}
    </RDM.Item>
  )
}

/** Visual divider between groups of items. */
export function DropdownSeparator() {
  return <RDM.Separator className="my-1 h-px bg-line" />
}

/** Non-interactive label heading a group of items. */
export function DropdownLabel({ children }: { children: ReactNode }) {
  return <RDM.Label className="px-2.5 py-1.5 text-xs font-medium text-ink-subtle">{children}</RDM.Label>
}
