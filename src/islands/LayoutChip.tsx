import { Popover, StageChip } from '@/components/primitives'
import { GridIcon, SpeakerLayoutIcon } from '@/components/icons'
import { useRoomStore, type LayoutMode } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

const LAYOUTS = [
  { value: 'grid', label: 'Grid', Icon: GridIcon },
  { value: 'speaker', label: 'Speaker', Icon: SpeakerLayoutIcon },
] as const satisfies ReadonlyArray<{ value: LayoutMode; label: string; Icon: typeof GridIcon }>

/**
 * Touch-only stage chip (top-left) showing the current layout, tap to switch.
 * Mobile already supports the swipe gesture + the named list in the More sheet;
 * this adds a discoverable affordance. Hides with the rest of the chrome.
 * Desktop switches layout from the More menu instead (pointer-fine:hidden here).
 */
export function LayoutChip({ visible }: { visible: boolean }) {
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const current = LAYOUTS.find((l) => l.value === layout) ?? LAYOUTS[0]
  const CurrentIcon = current.Icon

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-4 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-20 pointer-fine:hidden',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !visible && '-translate-y-[150%] opacity-0',
      )}
    >
      <Popover
        side="bottom"
        align="start"
        trigger={
          <StageChip className="pointer-events-auto" aria-label={`Layout: ${current.label}. Tap to change.`}>
            <CurrentIcon />
            {current.label}
          </StageChip>
        }
      >
        <div className="flex flex-col">
          {LAYOUTS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLayout(value)}
              data-active={layout === value}
              className="flex items-center gap-2.5 rounded-field px-2.5 py-2 text-sm hover:bg-sunken [&_svg]:size-4 data-[active=true]:text-accent"
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}
