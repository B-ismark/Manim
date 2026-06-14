import type { ReactNode } from 'react'
import { useMediaDeviceSelect } from '@livekit/components-react'
import {
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from '@/components/primitives'
import { CheckIcon } from '@/components/icons'

interface GroupProps {
  kind: MediaDeviceKind
  label: string
  /** Show a divider above this group (skipped for the first group). */
  divider?: boolean
}

function DeviceGroup({ kind, label, divider }: GroupProps) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  if (devices.length === 0) return null
  return (
    <>
      {divider && <DropdownSeparator />}
      <DropdownLabel>{label}</DropdownLabel>
      {devices.map((d) => (
        <DropdownItem
          key={d.deviceId}
          icon={d.deviceId === activeDeviceId ? <CheckIcon /> : <span className="size-4" />}
          onSelect={() => void setActiveMediaDevice(d.deviceId)}
        >
          <span className="truncate">{d.label || 'Unnamed device'}</span>
        </DropdownItem>
      ))}
    </>
  )
}

/** Tier-2 mid-call device switcher (mic / camera / speaker). */
export function DeviceMenu({ trigger }: { trigger: ReactNode }) {
  return (
    <DropdownMenu trigger={trigger} side="top" align="end" className="max-w-72">
      <DeviceGroup kind="audioinput" label="Microphone" />
      <DeviceGroup kind="videoinput" label="Camera" divider />
      <DeviceGroup kind="audiooutput" label="Speaker" divider />
    </DropdownMenu>
  )
}
