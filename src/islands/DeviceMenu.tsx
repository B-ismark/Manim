import { useMediaDeviceSelect } from '@livekit/components-react'
import { DropdownMenu, DropdownItem } from '@/components/primitives'
import { CheckIcon, ChevronDownIcon } from '@/components/icons'
import { toast } from '@/store/useToastStore'

interface RowProps {
  kind: MediaDeviceKind
  label: string
}

/**
 * One labeled device picker: the label, then a select-style trigger showing the
 * active device, opening the full list. Clearer than a single flat list — you
 * see the current camera/mic/speaker at a glance (Meet/Zoom settings pattern).
 * Hidden when the platform exposes no devices of that kind (e.g. speaker pick on
 * mobile Safari).
 */
function DeviceRow({ kind, label }: RowProps) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  if (devices.length === 0) return null
  const active = devices.find((d) => d.deviceId === activeDeviceId) ?? devices[0]

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-subtle">{label}</span>
      <DropdownMenu
        side="top"
        align="start"
        className="max-w-[min(20rem,80vw)]"
        trigger={
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-field bg-sunken px-2.5 py-2 text-sm hover:bg-line/40 [&_svg]:size-4"
          >
            <span className="truncate">{active?.label || `Default ${label.toLowerCase()}`}</span>
            <ChevronDownIcon className="shrink-0 text-ink-muted" />
          </button>
        }
      >
        {devices.map((d) => (
          <DropdownItem
            key={d.deviceId}
            icon={d.deviceId === active?.deviceId ? <CheckIcon /> : <span className="size-4" />}
            onSelect={() => {
              void setActiveMediaDevice(d.deviceId)
                .then(() => toast(`${label}: ${d.label || 'changed'}`, 'neutral'))
                .catch(() => toast(`Couldn't switch ${label.toLowerCase()}`, 'danger'))
            }}
          >
            <span className="truncate">{d.label || 'Unnamed device'}</span>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </label>
  )
}

/** Tier-2 mid-call device switcher — one labeled select per input/output. */
export function DeviceSettings() {
  return (
    <div className="space-y-2 px-1 pb-1">
      <DeviceRow kind="videoinput" label="Camera" />
      <DeviceRow kind="audioinput" label="Microphone" />
      <DeviceRow kind="audiooutput" label="Speaker" />
    </div>
  )
}
