import { Popover } from '@/components/primitives'
import { GridIcon, SpeakerLayoutIcon, SpotlightIcon } from '@/components/icons'
import { useRoomStore, type LayoutMode } from '@/store/useRoomStore'
import { cn } from '@/lib/cn'

const LAYOUTS = [
  { value: 'grid', label: 'Grid', Icon: GridIcon },
  { value: 'speaker', label: 'Speaker', Icon: SpeakerLayoutIcon },
  { value: 'spotlight', label: 'Spotlight', Icon: SpotlightIcon },
] as const satisfies ReadonlyArray<{ value: LayoutMode; label: string; Icon: typeof GridIcon }>

/**
 * Touch-only stage chip (top-left) showing the current layout, tap to switch.
 * Mobile already supports the swipe gesture + the named list in the More sheet;
 * this adds a discoverable affordance. Hides with the rest of the chrome.
 * Desktop uses the inline LayoutSwitcher instead (pointer-fine:hidden here).
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
          <button
            type="button"
            aria-label={`Layout: ${current.label}. Tap to change.`}
            className="pointer-events-auto flex items-center gap-1.5 rounded-control bg-overlay px-2.5 py-1.5 text-xs font-medium text-white shadow-raised backdrop-blur [&_svg]:size-4"
          >
            <CurrentIcon />
            {current.label}
          </button>
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
