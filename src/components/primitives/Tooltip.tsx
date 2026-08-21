import * as RT from '@radix-ui/react-tooltip'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Wrap the app once so tooltips share timing. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={400}>{children}</RT.Provider>
}

export interface TooltipProps
  // `content` is also a (legacy microdata) HTML attribute, so it has to be
  // dropped from the inherited set before we can mean our own thing by it.
  extends Omit<ComponentPropsWithoutRef<typeof RT.Trigger>, 'asChild' | 'children' | 'content'> {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Hover/focus hint attached to its child.
 *
 * `...rest` is forwarded onto the Radix trigger, and that is load-bearing, not
 * tidiness: a Tooltip is very often ALSO the trigger of a Popover or menu
 *
 *   <Popover trigger={<Tooltip content="Audio output"><IconButton …/></Tooltip>} />
 *
 * and Radix opens those by cloning their immediate child with an onClick and an
 * anchor ref (`Trigger asChild` → Slot). That child is this component. When it
 * accepted only {content, children, side}, the injected handler and ref landed on
 * a component that dropped them, so the control rendered perfectly and did
 * nothing at all — which is exactly how the audio-output button came to be dead
 * while every other caret (which passes a button straight through) worked.
 *
 * Spreading rest onto `RT.Trigger asChild` chains the two Slots — outer trigger →
 * tooltip trigger → the real button — so the press, the ref and the aria state all
 * reach the element that needs them. Keeping it in the primitive rather than
 * unwrapping the one call site means the next composition can't silently die the
 * same way.
 */
export function Tooltip({ content, children, side = 'top', ...rest }: TooltipProps) {
  return (
    <RT.Root>
      <RT.Trigger asChild {...rest}>
        {children}
      </RT.Trigger>
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
