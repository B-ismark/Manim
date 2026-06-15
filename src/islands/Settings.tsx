import { Dialog, Toggle } from '@/components/primitives'
import { ThemeSwitcher } from '@/islands/ThemeSwitcher'
import { useSoundStore } from '@/store/useSoundStore'

/**
 * Settings home for personal preferences — theme / color and UI sounds. This is
 * the single place appearance lives (no longer loose in the call control bar);
 * opened from the landing page and from the in-call More menu.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const soundOn = useSoundStore((s) => s.enabled)
  const toggleSound = useSoundStore((s) => s.toggle)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Appearance, theme color, and sounds."
    >
      <div className="flex flex-col gap-4">
        <Toggle
          checked={soundOn}
          onCheckedChange={toggleSound}
          label="UI sounds"
          className="w-full justify-between"
        />
        <div className="border-t border-line pt-1">
          <ThemeSwitcher />
        </div>
      </div>
    </Dialog>
  )
}
