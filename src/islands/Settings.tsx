import { Dialog, Toggle } from '@/components/primitives'
import { ThemeSwitcher } from '@/islands/ThemeSwitcher'
import { useSoundStore } from '@/store/useSoundStore'
import { useAppStore } from '@/store/useAppStore'
import { useNotifyStore } from '@/store/useNotifyStore'

/**
 * Settings home for personal preferences — your name, theme / color and UI
 * sounds. This is the single place appearance + profile live (no longer loose in
 * the call control bar); opened from the landing page and the in-call More menu.
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
  const displayName = useAppStore((s) => s.displayName)
  const setDisplayName = useAppStore((s) => s.setDisplayName)
  const notifyOn = useNotifyStore((s) => s.enabled)
  const enableNotify = useNotifyStore((s) => s.enable)
  const disableNotify = useNotifyStore((s) => s.disable)
  const notifSupported = typeof Notification !== 'undefined'
  const notifBlocked = notifSupported && Notification.permission === 'denied'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Your name, theme color, and sounds."
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="name"
            className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-xs text-ink-subtle">Saved on this device and used when you join a call.</span>
        </label>
        <Toggle
          checked={soundOn}
          onCheckedChange={toggleSound}
          label="UI sounds"
          className="w-full justify-between"
        />
        {notifSupported && (
          <div>
            <Toggle
              checked={notifyOn}
              disabled={notifBlocked}
              onCheckedChange={(v) => {
                if (v) void enableNotify()
                else disableNotify()
              }}
              label="Notify me of incoming calls"
              className="w-full justify-between"
            />
            {notifBlocked && (
              <p className="mt-1 text-xs text-ink-subtle">
                Notifications are blocked — re-enable them for this site in your browser settings.
              </p>
            )}
          </div>
        )}
        <div className="border-t border-line pt-1">
          <ThemeSwitcher />
        </div>
      </div>
    </Dialog>
  )
}
