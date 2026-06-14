import type { ReactNode } from 'react'
import { DropdownMenu, DropdownItem, IconButton } from '@/components/primitives'
import { CheckIcon, GridIcon, SpeakerLayoutIcon, SpotlightIcon } from '@/components/icons'
import { useRoomStore, type LayoutMode } from '@/store/useRoomStore'

const OPTIONS: { value: LayoutMode; label: string; icon: ReactNode }[] = [
  { value: 'grid', label: 'Grid', icon: <GridIcon /> },
  { value: 'speaker', label: 'Speaker', icon: <SpeakerLayoutIcon /> },
  { value: 'spotlight', label: 'Spotlight', icon: <SpotlightIcon /> },
]

/** Tier-1 stage layout switch (grid / speaker / spotlight). */
export function LayoutSwitcher() {
  const layout = useRoomStore((s) => s.layout)
  const setLayout = useRoomStore((s) => s.setLayout)
  const current = OPTIONS.find((o) => o.value === layout) ?? OPTIONS[0]

  return (
    <DropdownMenu
      side="top"
      align="center"
      trigger={<IconButton label="Change layout" icon={current.icon} />}
    >
      {OPTIONS.map((o) => (
        <DropdownItem key={o.value} icon={o.icon} onSelect={() => setLayout(o.value)}>
          <span className="flex-1">{o.label}</span>
          {layout === o.value && <CheckIcon className="size-4 text-accent" />}
        </DropdownItem>
      ))}
    </DropdownMenu>
  )
}
